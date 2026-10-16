import { Navigate, Route, Routes } from 'react-router-dom'
import { isReady, useAuth } from './lib/auth'
import { Loading } from './components/ui'
import Layout from './components/Layout'
import LoginPage from './pages/Login'
import DashboardPage from './pages/Dashboard'
import AccountsPage from './pages/Accounts'
import AccountDetailPage from './pages/AccountDetail'
import CharacterEditPage from './pages/CharacterEdit'
import PunishmentsPage from './pages/Punishments'
import ServersPage from './pages/Servers'
import ShopPage from './pages/Shop'
import AuditPage from './pages/Audit'
import AdminsPage from './pages/Admins'
import ProfilePage from './pages/Profile'

export default function App() {
  const { me, loading } = useAuth()
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loading />
      </div>
    )
  }
  // Chưa đăng nhập, hoặc chưa xong 2FA / đổi mật khẩu tạm -> chỉ có màn đăng nhập (tự dẫn qua từng bước).
  if (!isReady(me)) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    )
  }
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="accounts/:id" element={<AccountDetailPage />} />
        <Route path="characters/:cid" element={<CharacterEditPage />} />
        <Route path="punishments" element={<PunishmentsPage />} />
        <Route path="servers" element={<ServersPage />} />
        <Route path="shop" element={<ShopPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="admins" element={<AdminsPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
