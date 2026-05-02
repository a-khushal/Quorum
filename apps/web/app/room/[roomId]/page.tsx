import { RouteGuard } from "../../../components/route-guard";
import { RoomWorkspace } from "../../../components/room-workspace";

export default async function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;

  return (
    <RouteGuard>
      <RoomWorkspace roomId={roomId} />
    </RouteGuard>
  );
}
