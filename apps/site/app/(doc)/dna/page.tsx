import { redirect } from "next/navigation";

// dna voting is season-0 dormant — its rules live in the docs until the power ledger opens.
export default function DnaPage() {
  redirect("/docs#dna");
}
