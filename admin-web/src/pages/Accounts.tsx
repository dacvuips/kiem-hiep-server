import AccountsTable from '../components/AccountsTable'
import { PageHeader } from '../components/ui'

export default function AccountsPage() {
  return (
    <>
      <PageHeader title="Tài khoản" desc="Tra cứu tài khoản người chơi theo tên, email, IP, mã hoặc tên nhân vật." />
      <AccountsTable
        tabs={[
          { value: 'all', label: 'Tất cả' },
          { value: 'active', label: 'Hoạt động' },
          { value: 'banned', label: 'Bị khóa' },
          { value: 'muted', label: 'Bị cấm chat' },
        ]}
      />
    </>
  )
}
