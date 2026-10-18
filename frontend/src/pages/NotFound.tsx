import { Link } from "react-router-dom";
import { EmptyState, buttonClass } from "../components/ui";

export function NotFound() {
  return (
    <EmptyState title="This page doesn't exist">
      <p>Check the address, or go back to browsing.</p>
      <Link to="/" className={`${buttonClass("primary")} mt-4`}>Browse listings</Link>
    </EmptyState>
  );
}
