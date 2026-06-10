import pageStyles from "../page.module.css";
import { ValidateTutorForm } from "./validate-tutor-form";

export default function ValidateTutorPage() {
  return (
    <main className={pageStyles.main}>
      <ValidateTutorForm />
    </main>
  );
}
