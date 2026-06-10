import { auth } from "@/auth";
import { NavMenu } from "./nav-menu";
import styles from "./status-bar.module.css";
import { UserMenu } from "./user-menu";

// Persistent top chrome. Server component so it can read the session directly and
// pass the user down to the (client) user menu.
export async function StatusBar() {
  const session = await auth();
  return (
    <header className={styles.bar}>
      <NavMenu />
      <UserMenu user={session?.user ?? null} />
    </header>
  );
}
