import {GTFSFileStream} from "./GTFSFileStream";
import {TransXChange} from "../transxchange/TransXChange";

export class ShapesStream extends GTFSFileStream<TransXChange> {
    protected header: string = "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence";

    protected transform(data: TransXChange): void {
        const serviceCode = Object.values(data.Services)[0].ServiceCode;

        for (const k in data.RouteLinks) {
            const routeLink = data.RouteLinks[k];
            // Make shape IDs more unique by concatenating service code (route ID) and route link ID.
            this.pushLine(`${routeLink.Id},${routeLink.Latitude},${routeLink.Longitude},${Number(k) + 1}`);
        }
    }
}