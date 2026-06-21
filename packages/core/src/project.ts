import * as fs from 'fs';
import * as path from 'path';

export interface UiPathProject {
    readonly projectJsonPath: string;
    readonly projectDir: string;
    readonly name: string;
    readonly description: string;
    readonly projectVersion: string;
    readonly dependencies: Record<string, string>;
    readonly modernBehavior: boolean;
    readonly targetFramework: string | null;
    readonly objectsDir: string;
    readonly bindingsJsonPath: string;
    readonly entryPointsJsonPath: string;
}

interface RawProjectJson {
    name?: string;
    description?: string;
    projectVersion?: string;
    dependencies?: Record<string, string>;
    targetFramework?: string;
    designOptions?: {
        modernBehavior?: boolean;
    };
}

export function openProject(projectJsonPath: string): UiPathProject {
    const absPath = path.resolve(projectJsonPath);
    const raw = fs.readFileSync(absPath, 'utf8');
    const pj = JSON.parse(raw) as RawProjectJson;
    const projectDir = path.dirname(absPath);

    return {
        projectJsonPath: absPath,
        projectDir,
        name:           pj.name        ?? path.basename(projectDir),
        description:    pj.description ?? '',
        projectVersion: pj.projectVersion ?? '0.0.0',
        dependencies:   pj.dependencies  ?? {},
        modernBehavior: pj.designOptions?.modernBehavior ?? false,
        targetFramework: pj.targetFramework ?? null,
        objectsDir:          path.join(projectDir, '.objects'),
        bindingsJsonPath:    path.join(projectDir, 'bindings.json'),
        entryPointsJsonPath: path.join(projectDir, 'entry-points.json'),
    };
}
