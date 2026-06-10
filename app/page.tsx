import styles from "./page.module.css";
import { TutorChat } from "./tutor-chat";

export default function Home() {
  return (
    <main className={styles.main}>
      <TutorChat />
    </main>
  );
}
