import { redirect } from "next/navigation";

// the graveyard is a rail tab in the arena; full final words on each quant's file.
export default function GraveyardPage() {
  redirect("/?rail=graves");
}
