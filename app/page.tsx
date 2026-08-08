import type { Metadata } from "next";
import LumenExperience from "./LumenExperience";

export const metadata: Metadata = {
  title: "Lumen — a digital lifeform",
  description: "Meet a developing cell-like lifeform shaped by movement, conversation, and return.",
};

export default function Home() {
  return <LumenExperience />;
}
