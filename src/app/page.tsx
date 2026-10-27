import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function Home() {
  redirect((await getCurrentUser()) ? "/tracker" : "/login");
}
