import fs from "fs";
import path from "path";
import DashboardClient from "@/components/DashboardClient";
import { ChicagoData } from "@/types";

export default async function Dashboard() {
  const filePath = path.join(process.cwd(), "public", "data", "chicago.json");
  const fileContents = fs.readFileSync(filePath, "utf8");
  const mapData: ChicagoData = JSON.parse(fileContents);
  return <DashboardClient data={mapData} />;
}
