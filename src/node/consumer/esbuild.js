import { build } from "esbuild";
import { readFileSync, rmSync } from "fs";

const { devDependencies } = JSON.parse(readFileSync("./package.json", "utf8"));

const start = Date.now();

try {
    const outdir = "dist";

    rmSync(outdir, { recursive: true, force: true });

    build({
        bundle: true,
        entryPoints: [
            "./src/index.js",
        ],
        keepNames: true,
        minify: true,
        outbase: "./src",
        outdir,
        outExtension: {
            ".js": ".cjs",
        },
        platform: "node",
        plugins: [
            {
                name: "populate-import-meta",
                setup: ({ onLoad }) => {
                    onLoad({ filter: new RegExp(`${import.meta.dirname}/src/.*.(js|ts)$`) }, args => {
                        const contents = readFileSync(args.path, "utf8");

                        const transformedContents = contents
                            .replace(/import\.meta/g, `{dirname:__dirname,filename:__filename}`)
                            .replace(/import\.meta\.filename/g, "__filename")
                            .replace(/import\.meta\.dirname/g, "__dirname");

                        return { contents: transformedContents, loader: "default" };
                    });
                },
            }
        ],
    }).then(() => {
        // biome-ignore lint/style/useTemplate: <explanation>
        console.log("⚡ " + "\x1b[32m" + `Done in ${Date.now() - start}ms`);
    });
} catch (e) {
    console.log(e);
    process.exit(1);
}