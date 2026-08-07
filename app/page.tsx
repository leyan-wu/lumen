import type { Metadata } from "next";
import LumenExperience from "./LumenExperience";

export const metadata: Metadata = {
  title: "Lumen — a digital lifeform",
  description: "Meet a small digital creature that learns how you move.",
};

export default function Home() {
  return <LumenExperience />;
}
