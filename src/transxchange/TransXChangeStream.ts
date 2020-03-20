import {
  DateRange,
  DaysOfWeek,
  JourneyPatterns,
  JourneyPatternSections,
  JourneyStop,
  Lines,
  Mode,
  OperatingProfile,
  Operators, RouteLink,
  Services,
  StopActivity,
  StopPoint, TimingLink,
  TransXChange,
  VehicleJourney
} from "./TransXChange";
import {Transform, TransformCallback} from "stream";
import autobind from "autobind-decorator";
import {Duration, LocalDate, LocalTime} from "js-joda";
// Used for Easting/Northing -> Longitude/Latitude conversion
import proj4 = require("proj4");

/**
 * Transforms JSON objects into a TransXChange objects
 */
@autobind
export class TransXChangeStream extends Transform {

  constructor() {
    super({ objectMode: true });
    proj4.defs("EPSG:27700",
        "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs");
  }

  /**
   * Extract the stops, journeys and operators and emit them as a TransXChange object
   */
  public _transform(data: any, encoding: string, callback: TransformCallback): void {
    const tx = data.TransXChange;
    const patternIndex = tx.VehicleJourneys[0].VehicleJourney.reduce(this.getJourneyPatternIndex, {});
    const services = tx.Services[0].Service.reduce(this.getServices, {});

    const result: TransXChange = {
      StopPoints: tx.StopPoints[0].AnnotatedStopPointRef ?
          tx.StopPoints[0].AnnotatedStopPointRef.map(this.getAnnotatedStop) :
          (tx.StopPoints[0].StopPoint ? tx.StopPoints[0].StopPoint.map(this.getStop) : {}),
      JourneySections: tx.JourneyPatternSections[0].JourneyPatternSection.reduce(this.getJourneySections, {}),
      Operators: tx.Operators[0].Operator ?
          tx.Operators[0].Operator.reduce(this.getOperators, {}) :
          (tx.Operators[0].LicensedOperator ?
              tx.Operators[0].LicensedOperator.reduce(this.getOperators, {}) :
              {}),
      Services: services,
      VehicleJourneys: tx.VehicleJourneys[0].VehicleJourney.map((v: any) => this.getVehicleJourney(v, patternIndex,
          services)),
      Routes: tx.Routes[0],
      RouteLinks: tx.RouteSections[0].RouteSection.map((rs: any) => {

        // !!!! NOTE !!!!
        //
        //                                                                        [easting, northing]
        //                                                                                 |
        //                                                                                 |
        //                                                                                 V
        // proj4("EPSG:27700", "+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs", [355679, 218477]) returns
        // [ longitude, latitude ] (=== [ easting (x), northing (y) ]), not [ latitude, longitude ]
        //
        // !!!!!!!!!!!!!!
        //
        // console.log(proj4("EPSG:27700", "+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs", [355679, 218477]));

        const id = rs.$.id;

        return rs.RouteLink.map((rl: any) => {
          return rl.Track ? rl.Track[0].Mapping[0].Location.map((location: any) => {
            // const routeLink: RouteLink = {
            //   Id: id,
            //   Latitude: location.Latitude ?
            //       location.Latitude[0] :
            //       (location.Translation ?
            //           Number(location.Translation[0].Latitude[0]) :
            //           undefined),
            //   Longitude: location.Longitude ?
            //       location.Longitude[0] :
            //       (location.Translation ?
            //           Number(location.Translation[0].Longitude[0]) :
            //           undefined),
            //   Easting: location.Easting ? location.Easting[0] : (location.Translation ? Number(location.Translation[0].Easting[0]) : undefined),
            //   Northing: location.Northing ? location.Northing[0] : (location.Translation ? Number(location.Translation[0].Northing[0]) : undefined)
            // };

            const latLon = this.getLocation(location);

            const routeLink: RouteLink = {
              Id: id,
              Latitude: latLon[0],
              Longitude: latLon[1],
              Easting: location.Easting ?
                  Number(location.Easting[0]) :
                  (location.Translation ? Number(location.Translation[0].Easting[0]) : 0),
              Northing: location.Northing ?
                  Number(location.Northing[0]) :
                  (location.Translation ? Number(location.Translation[0].Northing[0]) : 0)
            };

            return routeLink;
          }) : {}
        })
      }).reduce((acc: any, data: any) => acc.concat(data), [])
          .reduce((acc: any, data: any) => acc.concat(data), [])
          .filter((l: any) => l.Id)
      // TODO: this ^^^ is not the best use of `reduce()`...
    };

    callback(undefined, result);
  }

  private getLocation(location: any): [number, number] {
    const lat = this.getLat(location);
    const lon = this.getLon(location);
    return [ lat, lon ];
  }

  private getLat(location: any): number {
    if (location.Latitude) {
      return Number(location.Latitude[0]);
    }

    if (location.Translation && location.Translation[0].Latitude) {
      return Number(location.Translation[0].Latitude[0]);
    }

    if (location.Northing && location.Easting) {
      return proj4("EPSG:27700", "+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs",
          [Number(location.Easting[0]), Number(location.Northing[0])])[1];
    }

    if (location.Translation && (location.Translation[0].Northing && location.Translation[0].Easting)) {
      return proj4("EPSG:27700", "+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs",
          [Number(location.Translation[0].Easting[0]), Number(location.Translation[0].Northing[0])])[1];
    }

    return 0.0;
  }

  private getLon(location: any): number {
    if (location.Longitude) {
      return Number(location.Longitude[0]);
    }

    if (location.Translation && location.Translation[0].Longitude) {
      return Number(location.Translation[0].Longitude[0]);
    }

    if (location.Northing && location.Easting) {
      return proj4("EPSG:27700", "+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs",
          [Number(location.Easting[0]), Number(location.Northing[0])])[0];
    }

    if (location.Translation && (location.Translation[0].Northing && location.Translation[0].Easting)) {
      return proj4("EPSG:27700", "+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs",
          [Number(location.Translation[0].Easting[0]), Number(location.Translation[0].Northing[0])])[0];
    }

    return 0.0;
  }

  private convertLocation(location: any): ({ lat: number, lon: number }) {
      const projectionEpsg27700 = "EPSG:27700";
      const toProjection = "+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs";

      if (location.Northing && location.Easting) {
          let arr = proj4(projectionEpsg27700, toProjection,
              [Number(location.Easting[0]), Number(location.Northing[0])]);
          return { lon: arr[0], lat: arr[1] };
      }

      if (location.Translation && (location.Translation[0].Northing && location.Translation[0].Easting)) {
          let arr = proj4(projectionEpsg27700, toProjection,
              [Number(location.Translation[0].Easting[0]), Number(location.Translation[0].Northing[0])]);
          return { lon: arr[0], lat: arr[1] };
      }

      return { lon: 0.0, lat: 0.0 };
  }

  private getAnnotatedStop(stop: any): StopPoint {
    return {
      StopPointRef: stop.StopPointRef[0],
      CommonName: stop.CommonName[0],
      LocalityName: stop.LocalityName ? stop.LocalityName[0] : "",
      LocalityQualifier: stop.LocalityQualifier ? stop.LocalityQualifier[0] : "",
      Location: {
        Latitude: stop.Location && stop.Location[0].Latitude ? Number(stop.Location[0].Latitude[0]) : 0.0,
        Longitude: stop.Location && stop.Location[0].Longitude ? Number(stop.Location[0].Longitude[0]) : 0.0,
        Easting: stop.Location && stop.Location[0].Easting ? Number(stop.Location[0].Easting[0]) : 0.0,
        Northing: stop.Location && stop.Location[0].Northing ? Number(stop.Location[0].Northing[0]) : 0.0
      }
    };
  }

  private getStop(stop: any): StopPoint {
    return {
      StopPointRef: stop.AtcoCode[0],
      CommonName: stop.Descriptor[0].CommonName[0],
      LocalityName: stop.Place[0].NptgLocalityRef[0],
      LocalityQualifier: stop.Place[0].NptgLocalityRef[0],
      Location: {
        Latitude: stop.Location && stop.Location[0].Latitude ? Number(stop.Location[0].Latitude[0]) : 0.0,
        Longitude: stop.Location && stop.Location[0].Longitude ? Number(stop.Location[0].Longitude[0]) : 0.0,
        Easting: stop.Location && stop.Location[0].Easting ? Number(stop.Location[0].Easting[0]) : 0.0,
        Northing: stop.Location && stop.Location[0].Northing ? Number(stop.Location[0].Northing[0]) : 0.0
      }
    };
  }

  private getJourneySections(index: JourneyPatternSections, section: any): JourneyPatternSections {
    index[section.$.id] = section.JourneyPatternTimingLink ? section.JourneyPatternTimingLink.map(this.getLink) : [];

    return index;
  }

  private getLink(l: any): TimingLink {
    return {
      From: this.getJourneyStop(l.From[0]),
      To: this.getJourneyStop(l.To[0]),
      RunTime: Duration.parse(l.RunTime[0])
    };
  }

  private getJourneyStop(stop: any): JourneyStop {
    return {
      Activity: stop.Activity ? stop.Activity[0] : StopActivity.PickUpAndSetDown,
      StopPointRef: stop.StopPointRef[0],
      TimingStatus: stop.TimingStatus[0],
      WaitTime: stop.WaitTime && Duration.parse(stop.WaitTime[0])
    };
  }

  private getOperators(index: Operators, operator: any): Operators {
    // if (operator.OperatorNameOnLicence && operator.OperatorNameOnLicence[0]) {
    //   console.log("operator:", operator.OperatorNameOnLicence[0]);
    //   console.log("operator:", typeof operator.OperatorNameOnLicence[0]);
    // }

    index[operator.$.id] = {
      OperatorCode: operator.OperatorCode[0],
      OperatorShortName: operator.OperatorShortName[0],
      OperatorNameOnLicence: this.getOperatorNameOnLicense(operator),
    };

    return index;
  }

  private getOperatorNameOnLicense(op: any): string {
    if (op.OperatorNameOnLicence) {
      if (op.OperatorNameOnLicence[0] === 'object') {
        return op.OperatorNameOnLicence[0]._;
      }

      if ((typeof op.OperatorNameOnLicence[0]) === 'string') {
        return op.OperatorNameOnLicence[0];
      }
    }

    return "";
  }

  private getServices(index: Services, service: any): Services {
    index[service.ServiceCode[0]] = {
      ServiceCode: service.ServiceCode[0],
      Lines: service.Lines[0].Line.reduce(this.getLines, {}),
      OperatingPeriod: this.getDateRange(service.OperatingPeriod[0]),
      RegisteredOperatorRef: service.RegisteredOperatorRef[0],
      Description: service.Description ? service.Description[0].replace(/[\r\n\t]/g, "") : "",
      Mode: service.Mode ? service.Mode[0] : Mode.Bus,
      StandardService: service.StandardService[0].JourneyPattern.reduce(this.getJourneyPattern, {}),
      ServiceOrigin: service.StandardService[0].Origin[0],
      ServiceDestination: service.StandardService[0].Destination[0],
      Via: service.StandardService[0].Vias ? service.StandardService[0].Vias[0].Via[0] : "",
      OperatingProfile: service.OperatingProfile
        ? this.getOperatingProfile(service.OperatingProfile[0])
        : undefined
    };

    return index;
  }

  private getJourneyPattern(patterns: JourneyPatterns, pattern: any): JourneyPatterns {
    patterns[pattern.$.id] = {
      Direction: pattern.Direction[0],
      RouteRef: pattern.RouteRef[0],
      Sections: pattern.JourneyPatternSectionRefs
    };

    return patterns;
  }

  private getLines(index: Lines, line: any): Lines {
    index[line.$.id] = line.LineName[0];

    return index;
  }

  private getDateRange(dates: any): DateRange {
    return {
      StartDate: LocalDate.parse(dates.StartDate[0]),
      EndDate: dates.EndDate && dates.EndDate[0] ? LocalDate.parse(dates.EndDate[0]) : LocalDate.parse("2099-12-31"),
    };
  }

  private getVehicleJourney(vehicle: any, index: JourneyPatternIndex, services: Services): VehicleJourney {
    if (vehicle.PrivateCode[0] === '0H1MFBLUE:O:4:1') {
      console.log(vehicle.OperatingProfile[0].RegularDayType[0].DaysOfWeek[0]);
    }

    return {
      PrivateCode: vehicle.PrivateCode[0],
      LineRef: vehicle.LineRef[0],
      ServiceRef: vehicle.ServiceRef[0],
      VehicleJourneyCode: vehicle.VehicleJourneyCode[0],
      JourneyPatternRef: vehicle.JourneyPatternRef ?
          vehicle.JourneyPatternRef[0] :
          index[vehicle.VehicleJourneyRef[0]],
      DepartureTime: LocalTime.parse(vehicle.DepartureTime[0]),
      OperatingProfile: vehicle.OperatingProfile ?
          this.getOperatingProfile(vehicle.OperatingProfile[0]) :
          services[vehicle.ServiceRef[0]].OperatingProfile!,
      OperationalBlockNumber: vehicle.Operational && vehicle.Operational[0].Block ?
          vehicle.Operational[0].Block[0].BlockNumber[0] :
          "",
      TicketMachineServiceCode: vehicle.Operational && vehicle.Operational[0].TicketMachine ?
          vehicle.Operational[0].TicketMachine[0].TicketMachineServiceCode[0] :
          "",
      TicketMachineJourneyCode: vehicle.Operational && vehicle.Operational[0].TicketMachine ?
          vehicle.Operational[0].TicketMachine[0].JourneyCode[0] :
          ""
    };
  }

  private getOperatingProfile(profile: any): OperatingProfile {
    const result = {
      BankHolidayOperation: {
        DaysOfOperation: [],
        DaysOfNonOperation: []
      },
      SpecialDaysOperation: {
        DaysOfOperation: [],
        DaysOfNonOperation: []
      },
      RegularDayType: profile.RegularDayType[0].DaysOfWeek
        ? this.getDaysOfWeek(profile.RegularDayType[0].DaysOfWeek[0])
        : "HolidaysOnly" as "HolidaysOnly"
    };

    if (profile.BankHolidayOperation && profile.BankHolidayOperation[0].DaysOfOperation && profile.BankHolidayOperation[0].DaysOfOperation[0]) {
      result.BankHolidayOperation.DaysOfOperation = profile.BankHolidayOperation[0].DaysOfOperation.map((bh: any) => Object.keys(bh)[0]);
    }
    if (profile.BankHolidayOperation && profile.BankHolidayOperation[0].DaysOfNonOperation && profile.BankHolidayOperation[0].DaysOfNonOperation[0]) {
      result.BankHolidayOperation.DaysOfNonOperation = profile.BankHolidayOperation[0].DaysOfNonOperation.map((bh: any) => Object.keys(bh)[0]);
    }
    if (profile.SpecialDaysOperation && profile.SpecialDaysOperation[0].DaysOfOperation && profile.SpecialDaysOperation[0].DaysOfOperation[0]) {
      result.SpecialDaysOperation.DaysOfOperation = profile.SpecialDaysOperation[0].DaysOfOperation[0].DateRange.map(this.getDateRange);
    }
    if (profile.SpecialDaysOperation && profile.SpecialDaysOperation[0].DaysOfNonOperation && profile.SpecialDaysOperation[0].DaysOfNonOperation[0]) {
      result.SpecialDaysOperation.DaysOfNonOperation = profile.SpecialDaysOperation[0].DaysOfNonOperation[0].DateRange.map(this.getDateRange);
    }

    return result;
  }

  private getDaysOfWeek(days: any): DaysOfWeek[] {
    return Object.keys(days).length === 0
      ? [[0, 0, 0, 0, 0, 0, 0]]
      : Object.keys(days).map(d => daysOfWeekIndex[d] || [0, 0, 0, 0, 0, 0, 0]);
  }

  private getJourneyPatternIndex(index: JourneyPatternIndex, vehicle: any): JourneyPatternIndex {
    if (vehicle.JourneyPatternRef) {
      index[vehicle.VehicleJourneyCode[0]] = vehicle.JourneyPatternRef[0];
    }

    return index;
  }
}

/**
 * TransXChange's comical idea of how to represent days of operation
 */
export const daysOfWeekIndex: Record<string, DaysOfWeek> = {
  "MondayToFriday": [1, 1, 1, 1, 1, 0, 0],
  "MondayToSaturday": [1, 1, 1, 1, 1, 1, 0],
  "MondayToSunday": [1, 1, 1, 1, 1, 1, 1],
  "NotSaturday": [1, 1, 1, 1, 1, 0, 1],
  "Weekend": [0, 0, 0, 0, 0, 1, 1],
  "Monday": [1, 0, 0, 0, 0, 0, 0],
  "Tuesday": [0, 1, 0, 0, 0, 0, 0],
  "Wednesday": [0, 0, 1, 0, 0, 0, 0],
  "Thursday": [0, 0, 0, 1, 0, 0, 0],
  "Friday": [0, 0, 0, 0, 1, 0, 0],
  "Saturday": [0, 0, 0, 0, 0, 1, 0],
  "Sunday": [0, 0, 0, 0, 0, 0, 1],
};

/**
 * VehicleJourneyCode to JourneyPatternRef
 */
export type JourneyPatternIndex = Record<string, string>;
