import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import AuthForm from '@/components/AuthForm'

export default async function LoginPage() {
  if (await currentUser()) redirect('/')
  return <AuthForm />
}
