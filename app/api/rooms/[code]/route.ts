import { access } from '../../../../lib/room-api';
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) { return access(request, (await params).code); }
export const POST = GET;
