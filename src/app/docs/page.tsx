import fs from 'fs';
import path from 'path';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Link from 'next/link';
import { DocsClient } from './docs-client';

export const metadata = {
    title: 'Documentação da API - ZapHub',
    description: 'Referência completa da API do ZapHub: mensagens, grupos, contatos, mídia e webhooks.',
    openGraph: {
        title: 'Documentação da API - ZapHub',
        description: 'Referência completa da API do ZapHub.',
        type: 'website',
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Documentação da API - ZapHub',
        description: 'Referência completa da API do ZapHub.',
    },
};

// Interface for Nested TOC
export interface TocItem {
    text: string;
    id: string;
}

export interface TocSection {
    title: string;
    id: string;
    items: TocItem[];
}

export default async function PublicDocsPage() {
    const filePath = path.join(process.cwd(), 'docs', 'API_DOCUMENTATION.md');
    const packagePath = path.join(process.cwd(), 'package.json');
    let content = '';
    let version = 'v1.0.0';

    try {
        content = fs.readFileSync(filePath, 'utf8');
        // Strip extraneous backslash escapes used for markdown brackets
        content = content.replace(/\\(\[)/g, '$1').replace(/\\(])/g, '$1');
        const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        version = `v${packageJson.version}`;
    } catch (err) {
        content = '# Error\n\nCould not load documentation file.';
        console.error("Error loading docs:", err);
    }

    // Nested TOC Generation
    const toc: TocSection[] = [];
    let currentSection: TocSection | null = null;

    content.split('\n').forEach(line => {
        if (line.startsWith('## ')) {
            // H2 - New Section
            const text = line.replace(/^## /, '').trim();
            const id = text.toLowerCase().replace(/[^\w]+/g, '-');

            // If we have a current section, push it to toc
            if (currentSection) {
                toc.push(currentSection);
            }

            currentSection = {
                title: text,
                id: id,
                items: []
            };
        } else if (line.startsWith('### ') && currentSection) {
            // H3 - Item in current section
            const text = line.replace(/^### /, '').trim();
            const id = text.toLowerCase().replace(/[^\w]+/g, '-');
            currentSection.items.push({ text, id });
        }
    });

    // Push the last section if exists
    if (currentSection) {
        toc.push(currentSection);
    }

    return (
        <div className="min-h-screen bg-background flex flex-col">
            {/* Header */}
            <header className="bg-card border-b sticky top-0 z-30 shadow-sm/50">
                <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="text-xl font-extrabold text-foreground">
                            ZapHub
                        </span>
                        <span className="px-2.5 py-0.5 rounded-full bg-primary/10 text-foreground text-xs font-semibold tracking-wide border border-primary/20">
                            {version}
                        </span>
                    </div>
                    <div className="flex items-center gap-4">
                        <Link
                            href="/swagger"
                            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                        >
                            Swagger UI
                        </Link>
                        <Link
                            href="/dashboard"
                            className="text-sm font-medium px-4 py-2 bg-foreground text-background rounded-lg hover:bg-foreground/90 transition-all shadow-md hover:shadow-lg"
                        >
                            Dashboard
                        </Link>
                    </div>
                </div>
            </header>

            <DocsClient content={content} toc={toc} />
        </div>
    );
}
