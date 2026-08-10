import { redirect } from "next/navigation";

// the machine room grew into the technical docs — one home for every rule in code.
export default function SystemPage() {
  redirect("/docs/technical");
}
