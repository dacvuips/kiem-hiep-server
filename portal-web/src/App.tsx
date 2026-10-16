import { Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { RequireAuth } from './lib/auth'
import Home from './pages/Home'
import Login from './pages/Login'
import Register from './pages/Register'
import Forgot from './pages/Forgot'
import TopUp from './pages/TopUp'
import Payment from './pages/Payment'
import AccountPage from './pages/Account'
import { NotFound, Support, Terms } from './pages/Static'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="dang-nhap" element={<Login />} />
        <Route path="dang-ky" element={<Register />} />
        <Route path="quen-mat-khau" element={<Forgot />} />
        <Route path="nap-the" element={<RequireAuth><TopUp /></RequireAuth>} />
        <Route path="nap-the/thanh-toan/:code" element={<RequireAuth><Payment /></RequireAuth>} />
        <Route path="tai-khoan" element={<RequireAuth><AccountPage /></RequireAuth>} />
        <Route path="dieu-khoan" element={<Terms />} />
        <Route path="ho-tro" element={<Support />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
