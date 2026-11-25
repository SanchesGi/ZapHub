// minha versao: imagem de uma figurinha da colecao do atendente. So o dono ve; o caminho do disco nunca sai daqui.
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { figurinhaDoUsuario, lerArquivoFigurinha } from "@/lib/figurinhas";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        const { id } = await params;
        if (!id || id.length > 64) return NextResponse.json({ status: false, message: "Invalid id", error: "Invalid id" }, { status: 400 });
        const f = await figurinhaDoUsuario(user.id, id); // de outro usuario = nao existe (404, sem revelar)
        if (!f) return NextResponse.json({ status: false, message: "Not found", error: "Not found" }, { status: 404 });
        const dados = await lerArquivoFigurinha(f.arquivo);
        if (!dados) return NextResponse.json({ status: false, message: "File not found", error: "File not found" }, { status: 404 });
        return new NextResponse(new Uint8Array(dados), {
            status: 200,
            headers: {
                "Content-Type": "image/webp",
                "Content-Length": String(dados.length),
                "Cache-Control": "private, max-age=3600",
                "X-Content-Type-Options": "nosniff",
                "Content-Disposition": 'inline; filename="figurinha.webp"',
            },
        });
    } catch (e) {
        console.error("Figurinha serve error:", e);
        return NextResponse.json({ status: false, message: "Failed to serve sticker", error: "Failed to serve sticker" }, { status: 500 });
    }
}
