import {DaysOfWeek, Holiday, OperatingProfile, Service, StopActivity, TimingLink, TransXChange} from "./TransXChange";
import {Transform, TransformCallback} from "stream";
import autobind from "autobind-decorator";
import {ChronoUnit, DateTimeFormatter, Duration, LocalDate, LocalTime} from "js-joda";
import {ATCOCode} from "../reference/NaPTAN";

/**
 * Transforms TransXChange objects into TransXChangeJourneys that are closer to GTFS calendars, calendar dates, trips
 * and stop times.
 */
@autobind
export class TransXChangeJourneyStream extends Transform {
  private calendars: Record<string, JourneyCalendar> = {};
  private serviceId: number = 1;
  private tripId: number = 1;

  constructor(private readonly holidays: BankHolidays) {
    super({ objectMode: true });
  }

  /**
   * Generate a journey
   */
  public _transform(schedule: TransXChange, encoding: string, callback: TransformCallback): void {
    for (const vehicle of schedule.VehicleJourneys) {
      // if (vehicle.ServiceRef === 'SER3') {
      //   console.log(vehicle)
      // }
      const service = schedule.Services[vehicle.ServiceRef];
      const journeyPattern = service.StandardService[vehicle.JourneyPatternRef];
      const sections = journeyPattern.Sections.reduce(
          (acc, s) => acc.concat(schedule.JourneySections[s]),
          [] as TimingLink[]
      );

      if (sections.length > 0) {
        const calendar = this.getCalendar(vehicle.OperatingProfile, schedule.Services[vehicle.ServiceRef]);
        const stops = this.getStopTimes(sections, vehicle.DepartureTime);
        const days: DaysOfWeek = vehicle.OperatingProfile.RegularDayType === "HolidaysOnly"
            ? [0, 0, 0, 0, 0, 0, 0]
            : this.mergeDays(vehicle.OperatingProfile.RegularDayType);
        // Old way of constructing trip IDs by incrementation, starting at 1
        //
        // const trip = {
        //   id: this.tripId++,
        //   shortName: service.ServiceDestination,
        //   direction: journeyPattern.Direction
        // };

        // new way of constructing trip IDs by combining service code, journey code, and private code
        const trip = {
          id: "\"" + vehicle.TicketMachineServiceCode + "-" +
              vehicle.TicketMachineJourneyCode + "-" +
              vehicle.PrivateCode.replace(/:/g, "") + "\"",
          shortName: service.ServiceDestination,
          direction: journeyPattern.Direction
        };
        const route = vehicle.ServiceRef;

        let res = schedule.Routes.Route.filter((r: any) => {
          return journeyPattern.RouteRef === r.$.id || (r.PrivateCode && journeyPattern.RouteRef === r.PrivateCode[0]);
        });

        const shapeId = res[0].RouteSectionRef[0];
        const blockId = vehicle.OperationalBlockNumber;

        this.push({calendar, stops, trip, route, shapeId, blockId});
      }
    }

    callback();
  }

  private getCalendar(operatingProfile: OperatingProfile, service: Service): JourneyCalendar {
    const days: DaysOfWeek = operatingProfile.RegularDayType === "HolidaysOnly"
      ? [0, 0, 0, 0, 0, 0, 0]
      : this.mergeDays(operatingProfile.RegularDayType);

    let startDate = service.OperatingPeriod.StartDate;
    let endDate = service.OperatingPeriod.EndDate;
    let excludes = [];
    let includes = [];

    for (const dates of operatingProfile.SpecialDaysOperation.DaysOfNonOperation) {
      // if the start date of the non-operation is on or before the start of the service date, change the calendar start date
      if (!dates.StartDate.isAfter(startDate)) {
        startDate = dates.EndDate.plusDays(1);
      }
      // if the end date of the non-operation is on or after the end of the service date, change the calendar end date
      else if (!dates.EndDate.isBefore(endDate) || dates.EndDate.year() >= 2037) {
        endDate = dates.StartDate.minusDays(1);
      }
      else if (dates.EndDate.toEpochDay() - dates.StartDate.toEpochDay() < 92) {
        excludes.push(...this.dateRange(dates.StartDate, dates.EndDate, days));
      }
      else {
        console.log("Warning: Ignored extra long break in service", dates, JSON.stringify(service));
      }
    }

    for (const holiday of operatingProfile.BankHolidayOperation.DaysOfNonOperation) {
      excludes.push(...this.getHoliday(holiday, startDate));
    }

    for (const holiday of operatingProfile.BankHolidayOperation.DaysOfOperation) {
      includes.push(...this.getHoliday(holiday, startDate));
    }

    const hash = this.getCalendarHash(days, startDate, endDate, includes, excludes);

    if (!this.calendars[hash]) {
      const id = this.serviceId++;
      this.calendars[hash] = { id, startDate, endDate, days, includes, excludes };
    }

    return this.calendars[hash];
  }

  private mergeDays(daysOfOperation: DaysOfWeek[]): DaysOfWeek {
    return daysOfOperation.reduce(
      (result, days) => result.map((day, index) => day || days[index]) as DaysOfWeek,
      [0, 0, 0, 0, 0, 0, 0]
    );
  }

  private dateRange(from: LocalDate, to: LocalDate, days: DaysOfWeek, dates: LocalDate[] = []): LocalDate[] {
    if (from.isAfter(to)) {
      return dates;
    }
    else if (days[from.dayOfWeek().value() - 1]) {
      return this.dateRange(from.plusDays(1), to, days, [...dates, from]);
    }
    else {
      return this.dateRange(from.plusDays(1), to, days, dates);
    }
  }

  private getHoliday(holiday: Holiday, startDate: LocalDate): LocalDate[] {
    return (this.holidays[holiday] || []).filter(date => date.isAfter(startDate));
  }

  private getCalendarHash(days: DaysOfWeek,
                          startDate: LocalDate,
                          endDate: LocalDate,
                          includes: LocalDate[],
                          excludes: LocalDate[]): string {
    return [
      days.toString(),
      startDate.toString(),
      endDate.toString(),
      includes.map(d => d.toString()).join(),
      excludes.map(d => d.toString()).join()
    ].join("_");
  }

  // TODO: this is the original function getStopTimes
  //
  // private getStopTimes(links: TimingLink[], departureTime: LocalTime): StopTime[] {
  //   const stops = [{
  //     stop: links[0].From.StopPointRef,
  //     arrivalTime: departureTime.format(DateTimeFormatter.ofPattern("HH:mm:ss")),
  //     departureTime: departureTime.format(DateTimeFormatter.ofPattern("HH:mm:ss")),
  //     pickup: true,
  //     dropoff: false,
  //     exactTime: links[0].From.TimingStatus === "PTP" || links[0].From.TimingStatus === "TIP"
  //   }];
  //
  //   let lastDepartureTime = Duration.between(LocalTime.parse("00:00"), departureTime);
  //
  //   for (const link of links) {
  //     const arrivalTime = lastDepartureTime.plusDuration(link.RunTime);
  //     // This originally only adds up wait times for "to" stops:
  //     lastDepartureTime = link.From.WaitTime ? arrivalTime.plusDuration(link.From.WaitTime) : arrivalTime;
  //     //
  //     // Using this function in order to take into account wait times at the "from" stop, plus the
  //     // lastDepartureTime = TransXChangeJourneyStream.getDepartureTime(arrivalTime, link);
  //
  //     stops.push({
  //       stop: link.To.StopPointRef,
  //       arrivalTime: this.getTime(arrivalTime),
  //       departureTime: this.getTime(lastDepartureTime),
  //       pickup: link.To.Activity === StopActivity.PickUp || link.To.Activity === StopActivity.PickUpAndSetDown,
  //       dropoff: link.To.Activity === StopActivity.SetDown || link.To.Activity === StopActivity.PickUpAndSetDown,
  //       exactTime: link.To.TimingStatus === "PTP" || link.To.TimingStatus === "TIP"
  //     });
  //   }
  //
  //   return stops;
  // }

  private getStopTimes(timingLinks: TimingLink[], departureTime: LocalTime): StopTime[] {
    const stopTimes = [];
    let previousTimingLink: TimingLink = timingLinks[0];
    let previousDepartureTime = Duration.between(LocalTime.parse("00:00"), departureTime);
    let durationZero = Duration.of(0, ChronoUnit.SECONDS);

    // console.log('timingLinks length: ', timingLinks.length);
    // console.log('checking timing links...');

    for (let i in timingLinks) {
      const currentTimingLink = timingLinks[i];
      // console.log('currentTimingLink: ', currentTimingLink, '\n');

      if (i === "0") {
        // Add wait time to the first departure time if available
        let waitTime = currentTimingLink.From.WaitTime || durationZero;
        const departureTime = previousDepartureTime.plusDuration(waitTime);

        let stopTime = {
          stop: currentTimingLink.From.StopPointRef,
          arrivalTime: this.getTime(departureTime),
          departureTime: this.getTime(departureTime),
          pickup: true,
          dropoff: false,
          exactTime: currentTimingLink.From.TimingStatus === "PTP" || currentTimingLink.From.TimingStatus === "TIP"
        };

        // console.log('adding_first_stop_time: ', stopTime, '\n');
        stopTimes.push(stopTime);
      } else {
        // Current arrival time is the previous departure time + previous run time + previous wait time if any
        const arrivalTime = previousDepartureTime
            .plusDuration(previousTimingLink.RunTime)
            .plusDuration(previousTimingLink.To.WaitTime || durationZero);

        // NOTE: this is really the current departure time being tracked by previousDepartureTime
        // Current departure time + current wait time
        previousDepartureTime = arrivalTime
            .plusDuration(currentTimingLink.From.WaitTime || durationZero);

        let stopTime = {
          stop: previousTimingLink.To.StopPointRef,
          arrivalTime: this.getTime(arrivalTime),
          departureTime: this.getTime(previousDepartureTime),
          pickup: previousTimingLink.To.Activity === StopActivity.PickUp || previousTimingLink.To.Activity === StopActivity.PickUpAndSetDown,
          dropoff: previousTimingLink.To.Activity === StopActivity.SetDown || previousTimingLink.To.Activity === StopActivity.PickUpAndSetDown,
          exactTime: previousTimingLink.To.TimingStatus === "PTP" || previousTimingLink.To.TimingStatus === "TIP"
        };

        // console.log('adding_next_stop_time: ', stopTime, '\n');
        stopTimes.push(stopTime);
      }

      previousTimingLink = currentTimingLink;
    }

    let lastTimingLink = timingLinks[timingLinks.length-1];

    // Current arrival time is the previous departure time + previous run time + previous wait time if any
    const arrivalTime = previousDepartureTime
        .plusDuration(previousTimingLink.RunTime)
        .plusDuration(previousTimingLink.To.WaitTime || durationZero);

    // NOTE: this is really the current departure time being tracked by previousDepartureTime
    // Current departure time + current wait time
    previousDepartureTime = arrivalTime
        .plusDuration(lastTimingLink.From.WaitTime || durationZero);

    let lastStopTime = {
      stop: lastTimingLink.To.StopPointRef,
      arrivalTime: this.getTime(arrivalTime),
      departureTime: this.getTime(previousDepartureTime),
      pickup: lastTimingLink.To.Activity === StopActivity.PickUp || lastTimingLink.To.Activity === StopActivity.PickUpAndSetDown,
      dropoff: lastTimingLink.To.Activity === StopActivity.SetDown || lastTimingLink.To.Activity === StopActivity.PickUpAndSetDown,
      exactTime: lastTimingLink.To.TimingStatus === "PTP" || lastTimingLink.To.TimingStatus === "TIP"
    };

    // console.log('adding_last_stop_time: ', lastStopTime, '\n');
    stopTimes.push(lastStopTime);

    // console.log('stopTimes.length: ', stopTimes.length);

    return stopTimes;
  }

  private static getDepartureTime(arrivalTime: Duration, link: TimingLink): Duration {
    // if (link.From.StopPointRef === '1900HA030290') {
    //   console.log("----------------------------------------------------------------");
    //   console.log("arrival [init]:", arrivalTime);
    // }

    if (link.From.WaitTime) {
      arrivalTime = arrivalTime.plusDuration(link.From.WaitTime);

      // if (link.From.StopPointRef === '1900HA030290') {
      //   console.log("link.From.WaitTime:", link.From.WaitTime);
      //   console.log("arrival+from_wait-time:", arrivalTime);
      // }
    }

    if (link.To.WaitTime) {
      arrivalTime = arrivalTime.plusDuration(link.To.WaitTime);

      // if (link.From.StopPointRef === '1900HA030290') {
      //   console.log("link.To.WaitTime:", link.To.WaitTime);
      //   console.log("arrival+to_wait-time:", arrivalTime);
      // }
    }

    // if (link.From.StopPointRef === '1900HA030290') {
    //   console.log("arrival [final]:", arrivalTime);
    // }

    return arrivalTime;
  }

  private getTime(time: Duration): string {
    const hour = time.toHours().toString().padStart(2, "0");
    const minute = (time.toMinutes() % 60).toString().padStart(2, "0");

    return hour + ":" + minute + ":00";
  }
}

export type BankHolidays = Record<Holiday, LocalDate[]>;

// export interface TransXChangeJourney {
//   calendar: JourneyCalendar
//   trip: {
//     id: number,
//     shortName: string,
//     direction: "inbound" | "outbound"
//   }
//   route: string,
//   stops: StopTime[],
//   shapeId: string,
//   blockId: string
// }
//
// export interface JourneyCalendar {
//   id: number,
//   startDate: LocalDate,
//   endDate: LocalDate,
//   days: DaysOfWeek,
//   includes: LocalDate[],
//   excludes: LocalDate[]
// }
//
// export interface StopTime {
//   stop: ATCOCode,
//   arrivalTime: string,
//   departureTime: string,
//   pickup: boolean,
//   dropoff: boolean,
//   exactTime: boolean
// }

export interface TransXChangeJourney {
  calendar: JourneyCalendar
  trip: {
    id: string,
    shortName: string,
    direction: "inbound" | "outbound"
  }
  route: string,
  stops: StopTime[],
  shapeId: string,
  blockId: string
}

export interface JourneyCalendar {
  id: number,
  startDate: LocalDate,
  endDate: LocalDate,
  days: DaysOfWeek,
  includes: LocalDate[],
  excludes: LocalDate[]
}

export interface StopTime {
  stop: ATCOCode,
  arrivalTime: string,
  departureTime: string,
  pickup: boolean,
  dropoff: boolean,
  exactTime: boolean
}
