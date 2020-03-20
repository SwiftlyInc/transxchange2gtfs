import {GTFSFileStream} from "./GTFSFileStream";
import {Mode, Service, TransXChange} from "../transxchange/TransXChange";

/**
 * Extract the routes from the TransXChange objects
 */
export class RoutesStream extends GTFSFileStream<TransXChange> {
  protected header = "route_id,agency_id,route_short_name,route_long_name,route_type,route_text_color,route_color,route_url,route_desc";

  private routesSeen: Record<string, boolean> = {};
  private routeType = {
    [Mode.Air]: 1100,
    [Mode.Bus]: 3,
    [Mode.Coach]: 3,
    [Mode.Ferry]: 4,
    [Mode.Train]: 2,
    [Mode.Tram]: 0,
    [Mode.Underground]: 1
  };

  protected transform(data: TransXChange): void {
    for (const service of Object.values(data.Services)) {
      this.addRoute(service);
    }
  }

  private addRoute(service: Service): void {
    const routeId = service.ServiceCode;
    // const routeId = Object.values(service.Lines)[0].trim();
    // console.log("Object.values(service.Lines)[0].trim():", Object.values(service.Lines)[0].trim());


    if (!this.routesSeen[routeId]) {
      this.routesSeen[routeId] = true;

      // const lineName = Object.values(service.Lines)[0].trim();
      const routeLongName = this.getRouteLongName(service);

      // const routeShortName = routeLongName.substr(0, 60);
      const routeShortName = Object.values(service.Lines)[0].trim();

      // this.pushLine(`${routeId},${service.RegisteredOperatorRef},${lineName},"${service.Description}",${this.routeType[service.Mode]},,,,"${service.Description}"`);
      this.pushLine(`${routeId},${service.RegisteredOperatorRef},"${routeShortName}","${routeLongName}",${this.routeType[service.Mode]},,,,"${service.Description}"`);
    }
  }

  private getRouteLongName(service: Service): string {
    // console.log("service:", service);

    const lineName = Object.values(service.Lines)[0].trim();

    if ((service.ServiceOrigin.trim().toLowerCase() === 'origin' ||
        service.ServiceDestination.trim().toLowerCase() === 'destination') && service.Via !== "") {
      // return lineName + " - " + service.Via;
      return service.Via;

    }
    // const routeLongName = (lineName + " - " +
    //     service.ServiceOrigin.trim().replace(/[^0-9a-zA-Z'\s]/gi, "/").replace(/^\s*[^0-9a-zA-Z]\s+/gi, "") +
    //     " - " +
    //     service.ServiceDestination.trim().replace(/[^0-9a-zA-Z'\s]/gi, "/").replace(/\s*^[^0-9a-zA-Z]\s+/gi, ""))
    //     .replace(/Road/g, "Rd")
    //     .replace(/Lane/g, "Ln")
    //     .replace(/Street/g, "St")
    //     .replace(/Court/g, "Ct")
    //     .replace(/Station/g, "Stn")
    //     .replace(/Avenue/g, "Ave")
    //     .replace(/Centre/g, "Ctr")
    //     .replace(/Center/g, "Ctr")
    //     .replace(/Drive/g, "Dr")
    //     .substr(0, 80);

    const routeLongName = (service.ServiceOrigin.trim().replace(/[^0-9a-zA-Z'\s]/gi, "/").replace(/^\s*[^0-9a-zA-Z]\s+/gi, "") +
        " - " +
        service.ServiceDestination.trim().replace(/[^0-9a-zA-Z'\s]/gi, "/").replace(/\s*^[^0-9a-zA-Z]\s+/gi, ""))
        .replace(/Road/g, "Rd")
        .replace(/Lane/g, "Ln")
        .replace(/Street/g, "St")
        .replace(/Court/g, "Ct")
        .replace(/Station/g, "Stn")
        .replace(/Avenue/g, "Ave")
        .replace(/Centre/g, "Ctr")
        .replace(/Center/g, "Ctr")
        .replace(/Drive/g, "Dr")
        .substr(0, 80);

    return routeLongName;
  }

}
