import { notFound } from "next/navigation";
import PreRequestDiagnostic from "./pre-request-diagnostic";

export default function QuickAoxPreRequestDiagnosticPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <PreRequestDiagnostic />;
}
