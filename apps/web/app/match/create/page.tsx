import { redirect } from "next/navigation";
import { MAIN_ARENA_PATH } from "@/lib/constants/arena";

export default function CreateMatchPage() {
  redirect(MAIN_ARENA_PATH);
}
