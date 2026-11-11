import { NextRequest, NextResponse } from "next/server";
import { readdir, stat, unlink } from "fs/promises";
import path from "path";
import { existsSync } from "fs";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { autorizarMidia } from "@/lib/autorizar-midia";
import { prisma } from "@/lib/prisma";
import { pastasDeLeitura, localizarMidia, nomeDeMidiaValido, nomeDoMediaUrl } from "@/lib/pasta-midia";
import { nomeParaDownload } from "@/lib/nome-download";

/**
 * GET /api/media — List media files with full hierarchy: User > Session > Sender
 */
export async function GET(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
    }

    try {
        // minha versao: le a pasta configurada e a antiga (arquivos ainda nao movidos), sem repetir nomes
        const pastaDe = new Map<string, string>();
        for (const pasta of await pastasDeLeitura()) {
            if (!existsSync(pasta)) continue;
            for (const n of await readdir(pasta)) {
                if (nomeDeMidiaValido(n) && !pastaDe.has(n)) pastaDe.set(n, pasta);
            }
        }
        if (pastaDe.size === 0) {
            return NextResponse.json({ status: true, message: "No media directory", data: { files: [], totalSize: 0, totalCount: 0 } });
        }

        const isSuperAdmin = user.role === "SUPERADMIN";

        // Get sessions with owner info
        const sessions = isSuperAdmin
            ? await prisma.session.findMany({
                include: { user: { select: { id: true, name: true, email: true } } },
                orderBy: { createdAt: "desc" },
            })
            : await prisma.session.findMany({
                where: { userId: user.id },
                include: { user: { select: { id: true, name: true, email: true } } },
                orderBy: { createdAt: "desc" },
            });

        // minha versao: de quem e cada arquivo vem das MENSAGENS das sessoes do usuario (Message.mediaUrl), nao do
        // prefixo do nome. Super Administrador ve tambem arquivos sem mensagem dona.
        const sessaoPorId = new Map(sessions.map(s => [s.id, s]));
        const mensagens = await prisma.message.findMany({
            where: { sessionId: { in: sessions.map(s => s.id) }, mediaUrl: { not: null } },
            select: { sessionId: true, keyId: true, mediaUrl: true, remoteJid: true, senderJid: true, pushName: true, fromMe: true, type: true, content: true, timestamp: true },
        });
        const mensagemDoArquivo = new Map<string, (typeof mensagens)[number]>();
        for (const m of mensagens) {
            const n = nomeDoMediaUrl(m.mediaUrl);
            if (n && pastaDe.has(n)) mensagemDoArquivo.set(n, m);
        }
        const ownedFiles: { name: string; msg: (typeof mensagens)[number] | null }[] = [];
        for (const name of pastaDe.keys()) {
            const msg = mensagemDoArquivo.get(name) || null;
            if (msg || isSuperAdmin) ownedFiles.push({ name, msg });
        }

        // Build response
        const files = await Promise.all(
            ownedFiles.map(async ({ name, msg: msgInfo }) => {
                const filePath = path.join(pastaDe.get(name)!, name);
                const fileStat = await stat(filePath);
                const ext = path.extname(name).toLowerCase();

                let type: "image" | "video" | "audio" | "document" = "document";
                if ([".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext)) type = "image";
                else if ([".mp4", ".avi", ".mkv", ".mov", ".webm"].includes(ext)) type = "video";
                else if ([".mp3", ".wav", ".ogg", ".opus", ".m4a"].includes(ext)) type = "audio";

                const dono = msgInfo ? sessaoPorId.get(msgInfo.sessionId) : undefined;
                const sessionId = dono?.sessionId || "unknown";
                const sessionInfo = dono ? { name: dono.name, ownerName: dono.user.name || dono.user.email, ownerId: dono.user.id } : undefined;
                const from = msgInfo?.fromMe
                    ? "Me"
                    : msgInfo?.senderJid || msgInfo?.remoteJid || "Unknown";
                const fromName = msgInfo?.pushName || null;

                return {
                    name,
                    // minha versao: nome para baixar (documento com o nome original; midia com tipo e data)
                    nomeDownload: nomeParaDownload(msgInfo ? { ...msgInfo, mediaUrl: `/api/media/${name}` } : { type: type.toUpperCase(), mediaUrl: `/api/media/${name}`, timestamp: fileStat.mtime }),
                    size: fileStat.size,
                    type,
                    ext,
                    sessionId,
                    sessionName: sessionInfo?.name || sessionId,
                    ownerName: sessionInfo?.ownerName || "Unknown",
                    ownerId: sessionInfo?.ownerId || "unknown",
                    from,
                    fromName,
                    fromMe: msgInfo?.fromMe ?? false,
                    createdAt: fileStat.birthtime.toISOString(),
                    modifiedAt: fileStat.mtime.toISOString(),
                    url: `/api/media/${encodeURIComponent(name)}`,
                };
            })
        );

        files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        const totalSize = files.reduce((sum, f) => sum + f.size, 0);

        return NextResponse.json({
            status: true,
            message: "Media files fetched successfully",
            data: {
                files,
                totalSize,
                totalCount: files.length,
            }
        });
    } catch (error: any) {
        console.error("Media list error:", error);
        return NextResponse.json({ status: false, message: "Failed to list media", error: "Failed to list media" }, { status: 500 });
    }
}

/**
 * DELETE /api/media — Delete selected media files (only user's own sessions)
 * Body: { filenames: string[] }
 */
export async function DELETE(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { filenames } = body;

        if (!Array.isArray(filenames) || filenames.length === 0) {
            return NextResponse.json({ status: false, message: "Invalid payload", error: "filenames array is required" }, { status: 400 });
        }

        let deleted = 0;
        let failed = 0;
        const errors: string[] = [];

        for (const filename of filenames) {
            if (typeof filename !== "string" || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
                errors.push(`Invalid filename: ${filename}`);
                failed++;
                continue;
            }

            // minha versao: apagar e acao de gerencia, decidida pelo registro da mensagem (Equipe so apaga da propria sessao)
            if (!(await autorizarMidia(user, filename, "apagar"))) {
                errors.push(`Forbidden: ${filename}`);
                failed++;
                continue;
            }

            const filePath = await localizarMidia(filename);
            if (!filePath) {
                errors.push(`Not found: ${filename}`);
                failed++;
                continue;
            }

            try {
                await unlink(filePath);
                deleted++;
            } catch (e) {
                errors.push(`Failed to delete: ${filename}`);
                failed++;
            }
        }

        return NextResponse.json({ status: true, message: "Media files processed", data: { deleted, failed, errors } });
    } catch (error: any) {
        console.error("Media delete error:", error);
        return NextResponse.json({ status: false, message: "Failed to delete media", error: "Failed to delete media" }, { status: 500 });
    }
}
