import * as fs from 'fs';
import * as path from 'path';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

// Handle ESM / CJS import interop for @babel/traverse
const traverse = (traverseModule as any).default || traverseModule;

export interface CodeChunkResult {
  filePath: string;
  chunkContent: string;
  startLine: number;
  endLine: number;
  type: string;
}

const validExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.yml', '.yaml', '.md', '.markdown', '.html', '.css', '.scss', '.less', '.vue', '.svelte', '.cpp', '.c', '.h', '.hpp', '.java', '.py', '.rb', '.go', '.rs', '.php', '.pl', '.sh', '.bat', '.ps1']);
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage']);
const validFiles = ['Dockerfile', '.gitignore', '.dockerignore'];

const ext = path.extname;
const base = path.basename;

/**
 * Recursively find all supported source code files in the directory
 */
export function getSourceFiles(dir: string, baseDir: string = dir): string[] {
  let results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        results = results.concat(getSourceFiles(fullPath, baseDir));
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (validExtensions.has(ext) || validFiles.includes(entry.name)) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

/**
 * Parses a code file into AST nodes (functions, classes, declarations)
 */
export function chunkFile(filePath: string, relativePath: string): CodeChunkResult[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const chunks: CodeChunkResult[] = [];

  try {
    const ast = parse(content, {
      sourceType: 'unambiguous',
      plugins: ['typescript', 'jsx'],
      errorRecovery: true
    });

    traverse(ast, {
      // Extract function declarations, class declarations, and export statements
      FunctionDeclaration(nodePath: any) {
        if (nodePath.node.loc) {
          const start = nodePath.node.loc.start.line;
          const end = nodePath.node.loc.end.line;
          chunks.push({
            filePath: relativePath,
            startLine: start,
            endLine: end,
            type: 'function',
            chunkContent: lines.slice(start - 1, end).join('\n')
          });
        }
      },
      ClassDeclaration(nodePath: any) {
        if (nodePath.node.loc) {
          const start = nodePath.node.loc.start.line;
          const end = nodePath.node.loc.end.line;
          chunks.push({
            filePath: relativePath,
            startLine: start,
            endLine: end,
            type: 'class',
            chunkContent: lines.slice(start - 1, end).join('\n')
          });
        }
      }
    });
  } catch {
    // If AST parsing fails on non-standard syntax, fallback to chunking the file whole
    chunks.push({
      filePath: relativePath,
      startLine: 1,
      endLine: lines.length,
      type: 'raw_file',
      chunkContent: content
    });
  }

  // Fallback: if file has code but no top-level functions/classes were extracted
  if (chunks.length === 0 && content.trim().length > 0) {
    chunks.push({
      filePath: relativePath,
      startLine: 1,
      endLine: lines.length,
      type: 'module',
      chunkContent: content
    });
  }

  return chunks;
}