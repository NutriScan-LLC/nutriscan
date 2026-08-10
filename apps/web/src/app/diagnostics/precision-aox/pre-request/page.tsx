import { notFound } from "next/navigation";
import PrecisionPreRequestDiagnostic from "./precision-pre-request-diagnostic";

export default function PrecisionAoxPreRequestDiagnosticPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <PrecisionPreRequestDiagnostic />;
}
