import pageStyles from "../page.module.css";
import { ValidateTutorForm } from "./validate-tutor-form";

export default function ValidateTutorPage() {
  return (
    <main className={pageStyles.main}>
      <h1 className={pageStyles.title}>Validate Tutor</h1>
      <ValidateTutorForm />
    </main>
  );
}
