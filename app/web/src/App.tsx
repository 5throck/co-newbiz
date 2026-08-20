import { Navigate, Route, Routes, Link, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth.tsx";
import { Login } from "./pages/Login.tsx";
import { PasswordChange } from "./pages/PasswordChange.tsx";
import { ProjectList } from "./pages/ProjectList.tsx";
import { ProjectDetail } from "./pages/ProjectDetail.tsx";
import { AdminConsole } from "./pages/AdminConsole.tsx";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p className="loading-splash">불러오는 중...</p>;
  if (!me) return <Navigate to="/login" state={{ from: location }} replace />;
  if (me.mustChangePassword && location.pathname !== "/password-change") {
    return <Navigate to="/password-change" replace />;
  }
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { me } = useAuth();
  if (me?.role !== "admin") return <p role="alert">관리자 권한이 필요합니다.</p>;
  return <>{children}</>;
}

function TopNav() {
  const { me, logout } = useAuth();
  if (!me) return null;
  return (
    <header className="top-nav">
      <Link to="/projects" className="brand">
        co-newbiz
      </Link>
      <nav aria-label="주 메뉴">
        <Link to="/projects">프로젝트</Link>
        {me.role === "admin" && <Link to="/admin">관리자 콘솔</Link>}
      </nav>
      <div className="top-nav-user">
        <span>
          {me.userId} ({me.role})
        </span>
        <button type="button" onClick={() => logout()}>
          로그아웃
        </button>
      </div>
    </header>
  );
}

export function App() {
  return (
    <AuthProvider>
      <TopNav />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/password-change"
          element={
            <RequireAuth>
              <PasswordChange />
            </RequireAuth>
          }
        />
        <Route
          path="/projects"
          element={
            <RequireAuth>
              <ProjectList />
            </RequireAuth>
          }
        />
        <Route
          path="/projects/:id"
          element={
            <RequireAuth>
              <ProjectDetail />
            </RequireAuth>
          }
        />
        <Route
          path="/admin"
          element={
            <RequireAuth>
              <RequireAdmin>
                <AdminConsole />
              </RequireAdmin>
            </RequireAuth>
          }
        />
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="*" element={<p>페이지를 찾을 수 없습니다.</p>} />
      </Routes>
    </AuthProvider>
  );
}
