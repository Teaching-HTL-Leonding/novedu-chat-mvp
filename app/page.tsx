import styles from "./page.module.css";
import { TutorChat } from "./tutor-chat";

export default function Home() {
  return (
    <main className={styles.main}>
      <h1 className={styles.title}>Chat Prototype</h1>
      <TutorChat />
    </main>
  );
}
