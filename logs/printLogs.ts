import chalk from "chalk";
import figlet from "figlet";

export const info = (...args: unknown[]) =>
  console.log(...args.map((msg) => chalk.hex("#9e9e9e")(String(msg ?? ""))));

export const success = (...args: unknown[]) =>
  console.log(...args.map((msg) => chalk.hex("#4CAF50")(String(msg ?? ""))));

export const errorLog = (...args: unknown[]) =>
  console.log(...args.map((msg) => chalk.hex("#b23b3b")(String(msg ?? ""))));

export const printASCII = (...args: string[]) =>
  console.log(
    chalk.white(
      args
        .map((msg) =>
          figlet.textSync(msg, {
            font: "Slant",
          }),
        )
        .join("\n"),
    ),
  );

export default chalk;
