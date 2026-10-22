import { DB } from "./db"
export async function getShipment() { return { ...DB.shipment } }
