import { auth } from "@/auth";
import { getTeacherView } from "@/lib/student-mode";
import { NavMenu } from "./nav-menu";
import { UserMenu } from "./user-menu";

// Persistent top chrome. Server component so it can read the session directly and
// pass the user down to the (client) user menu.
//
// The whole bar acts on the EFFECTIVE teacher status: a real teacher in student
// mode sees student navigation and no teacher badge — only the "Student mode"
// pill (with its exit control) gives the simulation away.
export async function StatusBar() {
  const session = await auth();
  const { studentMode, effectiveTeacher } = await getTeacherView();

  return (
    <header className="flex shrink-0 items-center justify-between gap-4 border-foreground/15 border-b bg-background px-5 py-2">
      <NavMenu isTeacher={effectiveTeacher} />
      <UserMenu
        user={session?.user ? { ...session.user, isTeacher: effectiveTeacher } : null}
        studentMode={studentMode}
      />
    </header>
  );
}
