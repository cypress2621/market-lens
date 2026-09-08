import { candidatesReport } from '@/lib/futures-market';
export async function GET(request: Request) {
  const profile = new URL(request.url).searchParams.get('profile') || 'steady';
  if (!['steady', 'active'].includes(profile))
    return Response.json({ error: '筛选模式无效' }, { status: 400 });
  try {
    return Response.json(
      await candidatesReport(profile as 'steady' | 'active'),
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '合约候选暂时不可用' },
      { status: 503 },
    );
  }
}
