import { NextRequest, NextResponse } from "next/server";
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { lerFaixa } from "@/lib/faixa-http";
import path from "path";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { autorizarMidia } from "@/lib/autorizar-midia";
import { localizarMidia } from "@/lib/pasta-midia";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ filename: string }> }
) {
    try {
        // Authentication check — require session or API key
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const { filename } = await params;

        // Security: Prevent directory traversal
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return NextResponse.json({ status: false, message: "Invalid filename", error: "Invalid filename" }, { status: 400 });
        }

        // minha versao: quem pode ver vem do registro da mensagem no banco (Message.mediaUrl -> sessao), nao do
        // prefixo do nome do arquivo. Arquivo sem mensagem dona: so Super Administrador.
        if (!(await autorizarMidia(user, filename, "ver"))) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this media", error: "Forbidden" }, { status: 403 });
        }

        // minha versao: procura na pasta configurada (e na antiga, enquanto a mudanca nao termina).
        // localizarMidia so aceita nomes no formato de midia: nunca serve outro arquivo da pasta.
        const filePath = await localizarMidia(filename);
        if (!filePath) {
            return NextResponse.json({ status: false, message: "File not found", error: "File not found" }, { status: 404 });
        }

        // Determine content type based on extension
        const ext = path.extname(filename).toLowerCase();
        const contentTypeMap: Record<string, string> = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.mp4': 'video/mp4',
            '.webm': 'video/webm',
            '.mov': 'video/quicktime',
            '.3gpp': 'video/3gpp',
            '.mpeg': 'audio/mpeg',
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.ogg': 'audio/ogg',
            '.opus': 'audio/opus',
            '.m4a': 'audio/mp4',
            '.pdf': 'application/pdf',
            '.bin': 'application/octet-stream',
        };

        const contentType = contentTypeMap[ext] || 'application/octet-stream';

        // minha versao: aceita pedido de TRECHO (Range). Sem isso, mudar a posicao de um video/audio voltava ao
        // inicio. Tambem passou a ler o arquivo aos poucos (antes carregava o video inteiro na memoria a cada pedido).
        const tamanho = (await stat(filePath)).size;
        const cabecalhos: Record<string, string> = {
            'Content-Type': contentType,
            'Content-Disposition': `inline; filename="${filename}"`,
            'Cache-Control': 'private, max-age=3600',
            'X-Content-Type-Options': 'nosniff',
            'Accept-Ranges': 'bytes',
        };
        const faixa = lerFaixa(request.headers.get('range'), tamanho);
        if (faixa === "invalida") {
            return new NextResponse(null, { status: 416, headers: { ...cabecalhos, 'Content-Range': `bytes */${tamanho}` } });
        }
        const { inicio, fim } = faixa || { inicio: 0, fim: Math.max(0, tamanho - 1) };
        const corpo = tamanho === 0
            ? null
            : (Readable.toWeb(createReadStream(filePath, { start: inicio, end: fim })) as ReadableStream);
        return new NextResponse(corpo, {
            status: faixa ? 206 : 200,
            headers: {
                ...cabecalhos,
                'Content-Length': String(tamanho === 0 ? 0 : fim - inicio + 1),
                ...(faixa ? { 'Content-Range': `bytes ${inicio}-${fim}/${tamanho}` } : {}),
            },
        });

    } catch (error: any) {
        console.error("Media serve error:", error);
        return NextResponse.json({ status: false, message: "Failed to serve media", error: "Failed to serve media" }, { status: 500 });
    }
}
