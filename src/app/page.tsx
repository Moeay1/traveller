import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import MapApp from '@/components/MapApp'
import { DEFAULT_REGION, REGIONS, RegionCode } from '@/lib/regions'

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function Home({ searchParams }: Props) {
  const user = await currentUser()
  if (!user) redirect('/login')

  // 在服务端就把国家定下来，分享链接首屏直接是对的，不会先闪一下中国再切
  const raw = (await searchParams).country
  const code = (typeof raw === 'string' ? raw : '').toUpperCase()
  const initialRegion: RegionCode = REGIONS.some((r) => r.code === code)
    ? (code as RegionCode)
    : DEFAULT_REGION

  return <MapApp user={user} initialRegion={initialRegion} />
}
