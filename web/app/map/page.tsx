import type { Metadata } from "next";
import MapApp from "@/components/MapApp";

export const metadata: Metadata = {
  title: "Shift Map — Field Shift",
};

export default function MapPage() {
  return <MapApp />;
}
