import clsx from "clsx";
import Image from "next/image";

import { Link } from "@/components/design-system";

interface AvatarProps {
  /**
   * Optional image to show instead of the avatar: URL, PNG string, or Static import
   */
  image?: string;

  /**
   * Optional link of the avatar
   */
  link?: string;

  /**
   * Optional size of the avatar
   */
  size?: number;

  className?: string;
}

const defaultImage =
  "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIHZpZXdCb3g9IjAgMCA0OCA0OCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTQwLjEyMzUgMzcuMzk1QzQyLjI3NzcgMzQuODAzMSA0My43NzU5IDMxLjczMDYgNDQuNDkxNSAyOC40MzcyQzQ1LjIwNzEgMjUuMTQzOSA0NS4xMTg5IDIxLjcyNjcgNDQuMjM0NSAxOC40NzQ2QzQzLjM1MDEgMTUuMjIyNSA0MS42OTU0IDEyLjIzMTMgMzkuNDEwNSA5Ljc1Mzk4QzM3LjEyNTUgNy4yNzY2NSAzNC4yNzc1IDUuMzg2MSAzMS4xMDc0IDQuMjQyMjRDMjcuOTM3MyAzLjA5ODM5IDI0LjUzODMgMi43MzQ4OSAyMS4xOTc5IDMuMTgyNDlDMTcuODU3NiAzLjYzMDA5IDE0LjY3NDIgNC44NzU2MiAxMS45MTcxIDYuODEzNzJDOS4xNTk5MyA4Ljc1MTgzIDYuOTEwMTIgMTEuMzI1NSA1LjM1Nzk5IDE0LjMxN0MzLjgwNTg2IDE3LjMwODUgMi45OTcwNiAyMC42Mjk4IDMuMDAwMDEgMjRDMy4wMDExNCAyOC44OTkyIDQuNzI3NjMgMzMuNjQxNiA3Ljg3NjUxIDM3LjM5NUw3Ljg0NjUxIDM3LjQyMDVDNy45NTE1MSAzNy41NDY1IDguMDcxNTEgMzcuNjU0NSA4LjE3OTUxIDM3Ljc3OUM4LjMxNDUxIDM3LjkzMzUgOC40NjAwMSAzOC4wNzkgOC41OTk1MSAzOC4yMjlDOS4wMTk1MSAzOC42ODUgOS40NTE1MSAzOS4xMjMgOS45MDQ1MSAzOS41MzRDMTAuMDQyNSAzOS42NiAxMC4xODUgMzkuNzc3IDEwLjMyNDUgMzkuODk3QzEwLjgwNDUgNDAuMzExIDExLjI5OCA0MC43MDQgMTEuODA5NSA0MS4wN0MxMS44NzU1IDQxLjExNSAxMS45MzU1IDQxLjE3MzUgMTIuMDAxNSA0MS4yMlY0MS4yMDJDMTUuNTE0NyA0My42NzQyIDE5LjcwNTcgNDUuMDAxIDI0LjAwMTUgNDUuMDAxQzI4LjI5NzQgNDUuMDAxIDMyLjQ4ODQgNDMuNjc0MiAzNi4wMDE1IDQxLjIwMlY0MS4yMkMzNi4wNjc1IDQxLjE3MzUgMzYuMTI2IDQxLjExNSAzNi4xOTM1IDQxLjA3QzM2LjcwMzUgNDAuNzAyNSAzNy4xOTg1IDQwLjMxMSAzNy42Nzg1IDM5Ljg5N0MzNy44MTggMzkuNzc3IDM3Ljk2MDUgMzkuNjU4NSAzOC4wOTg1IDM5LjUzNEMzOC41NTE1IDM5LjEyMTUgMzguOTgzNSAzOC42ODUgMzkuNDAzNSAzOC4yMjlDMzkuNTQzIDM4LjA3OSAzOS42ODcgMzcuOTMzNSAzOS44MjM1IDM3Ljc3OUMzOS45MyAzNy42NTQ1IDQwLjA1MTUgMzcuNTQ2NSA0MC4xNTY1IDM3LjQxOUw0MC4xMjM1IDM3LjM5NVpNMjQgMTJDMjUuMzM1IDEyIDI2LjY0MDEgMTIuMzk1OCAyNy43NTAxIDEzLjEzNzVDMjguODYwMSAxMy44NzkyIDI5LjcyNTMgMTQuOTMzNSAzMC4yMzYyIDE2LjE2NjlDMzAuNzQ3MSAxNy40MDAzIDMwLjg4MDggMTguNzU3NSAzMC42MjAzIDIwLjA2NjhDMzAuMzU5OSAyMS4zNzYyIDI5LjcxNyAyMi41Nzg5IDI4Ljc3MyAyMy41MjI5QzI3LjgyOSAyNC40NjY5IDI2LjYyNjIgMjUuMTA5OCAyNS4zMTY5IDI1LjM3MDNDMjQuMDA3NSAyNS42MzA3IDIyLjY1MDMgMjUuNDk3IDIxLjQxNjkgMjQuOTg2MkMyMC4xODM1IDI0LjQ3NTMgMTkuMTI5MyAyMy42MTAxIDE4LjM4NzYgMjIuNTAwMUMxNy42NDU5IDIxLjM5IDE3LjI1IDIwLjA4NSAxNy4yNSAxOC43NUMxNy4yNSAxNi45NTk4IDE3Ljk2MTIgMTUuMjQyOSAxOS4yMjcgMTMuOTc3QzIwLjQ5MjkgMTIuNzExMSAyMi4yMDk4IDEyIDI0IDEyWk0xMi4wMTA1IDM3LjM5NUMxMi4wMzY1IDM1LjQyNTQgMTIuODM2OSAzMy41NDUzIDE0LjIzODUgMzIuMTYxNEMxNS42NDAyIDMwLjc3NzQgMTcuNTMwMyAzMC4wMDEgMTkuNSAzMEgyOC41QzMwLjQ2OTcgMzAuMDAxIDMyLjM1OTkgMzAuNzc3NCAzMy43NjE1IDMyLjE2MTRDMzUuMTYzMSAzMy41NDUzIDM1Ljk2MzUgMzUuNDI1NCAzNS45ODk1IDM3LjM5NUMzMi42OTk4IDQwLjM1OTUgMjguNDI4NCA0Mi4wMDAxIDI0IDQyLjAwMDFDMTkuNTcxNiA0Mi4wMDAxIDE1LjMwMDIgNDAuMzU5NSAxMi4wMTA1IDM3LjM5NVoiIGZpbGw9IiM2NDY0NjQiLz4KPC9zdmc+Cg==";

const redirectUrl = "/artist/dashboard"; //TODO : needs to be replaced with the right url later

export function Avatar({ image, link, size = 11, className }: AvatarProps) {
  const hrefAttribute = link || redirectUrl;
  const sizeClass = `w-${size} h-${size}`;
  return (
    <div className={clsx("flex w-max flex-row items-center", className)}>
      <div
        className={clsx(
          "relative overflow-hidden rounded-full bg-dark-50 dark:bg-dark-90",
          sizeClass
        )}
      >
        <Link href={hrefAttribute} className="!no-underline">
          <Image
            src={image ? image : defaultImage}
            layout="fill"
            alt="Avatar Image"
          />
        </Link>
      </div>
    </div>
  );
}
