/**
 * Minimal structural copy of the Standard Schema v1 interface
 * (https://standardschema.dev). Types-only: any compliant validator
 * (zod, valibot, arktype, schemastery, ...) plugs in without a runtime
 * dependency on the framework.
 */
export interface StandardSchemaV1<TInput = unknown, TOutput = TInput> {
    readonly "~standard": {
        readonly version: 1;
        readonly vendor: string;
        readonly validate: (value: unknown) => Result<TOutput> | Promise<Result<TOutput>>;
        readonly types?: { input: TInput; output: TOutput } | undefined;
    };
}

export type Result<TOutput> =
    | { readonly value: TOutput; readonly issues?: undefined }
    | { readonly issues: readonly Issue[] };

export interface Issue {
    readonly message: string;
    readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined;
}

export class ConfigValidationError extends Error {
    constructor(
        readonly plugin: string,
        readonly issues: readonly Issue[],
    ) {
        super(
            `invalid config for plugin "${plugin}":\n${issues.map((issue) => `  - ${issue.message}`).join("\n")}`,
        );
        this.name = "ConfigValidationError";
    }
}

/** Validate `value` against a plugin's schema, throwing on failure. */
export async function validateConfig(
    plugin: string,
    schema: StandardSchemaV1<unknown, unknown>,
    value: unknown,
): Promise<unknown> {
    const result = await schema["~standard"].validate(value);
    if (result.issues) throw new ConfigValidationError(plugin, result.issues);
    return result.value;
}
