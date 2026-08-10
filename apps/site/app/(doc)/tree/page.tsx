import { redirect } from "next/navigation";

// the arena IS the tree — one view, no toggle.
export default function TreePage() {
  redirect("/");
}
