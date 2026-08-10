import { redirect } from "next/navigation";

// the arena IS the tree — culture view by default, tree view one toggle away.
export default function TreePage() {
  redirect("/");
}
