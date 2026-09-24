import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  assetKey,
  assetUrlForKey,
  UPLOAD_URL_TTL_SECONDS,
  type ChatUploadInput,
  type CreateUploadInput,
  type CreateUploadResult,
} from "@repo/api-contract";

/**
 * Presigned uploads to the legacy S3 bucket — docs/s3-assets-plan.md "Step 2".
 *
 * The browser PUTs bytes straight to S3 and then saves the resulting URL
 * through the owning module's own update mutation, so no file ever passes
 * through this API and tRPC stays the whole HTTP surface: no Express
 * controller, no multipart body, and the audit middleware still sees every
 * call that mints a URL.
 *
 * **No delete path, deliberately.** The credential this shares with
 * `back-bica-pack` carries `DeleteObject` across the whole flat bucket, which
 * also holds supplier invoices and employee photos, so a bug here could
 * unlink someone else's file. Clearing a document column therefore orphans its
 * object rather than removing it. If deletes are ever wanted, derive the key
 * from the **stored** column and never from `assetUrl()` output — encoding
 * first would ask S3 to delete `..._sabaidi%202.jpg` when the object is
 * `..._sabaidi 2.jpg`, a silent no-op (see `assetFileName` in assets.ts).
 */
@Injectable()
export class StorageService implements OnModuleDestroy {
  private readonly bucket: string;
  private readonly region: string;
  private readonly client: S3Client | null;

  constructor() {
    this.bucket = process.env.AWS_S3_BUCKET ?? "";
    this.region = process.env.AWS_REGION ?? "";

    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

    // Uploads are one feature of many: a checkout without AWS credentials
    // should still boot and run everything else, and fail loudly only if
    // someone actually tries to upload. Reads need no credentials at all —
    // anonymous GetObject works on this bucket — so nothing else is affected.
    this.client =
      this.bucket && this.region && accessKeyId && secretAccessKey
        ? new S3Client({
            region: this.region,
            credentials: { accessKeyId, secretAccessKey },
          })
        : null;
  }

  /** The client holds a keep-alive socket pool; release it on shutdown. */
  onModuleDestroy(): void {
    this.client?.destroy();
  }

  /** Whether uploads are configured, for a caller that wants to hide the UI. */
  get enabled(): boolean {
    return this.client !== null;
  }

  /**
   * Whether a URL points into the bucket this service writes to.
   *
   * For a caller that accepts an attachment URL from the client and renders it
   * to other users — the chat feed (docs/chat-plan.md §5). Every existing
   * upload call-site gates on an existing row instead (`assertUploadable`),
   * but a chat attachment is uploaded before its message exists, so there is
   * no row to assert against and the URL itself is the thing to check.
   *
   * The `enabled` guard is load-bearing, not defensive: the constructor
   * defaults both env vars to `""` so a checkout without AWS credentials still
   * boots, and with them empty the prefix below degenerates to
   * `https://.s3..amazonaws.com/` — which `startsWith` would match far too
   * loosely. An unconfigured server must reject every URL rather than accept a
   * malformed family of them.
   *
   * What this proves: the URL names an object in this bucket. What it does NOT
   * prove: that this app minted it. The bucket is flat and shared with legacy
   * `back-bica-pack`, so any key under the prefix passes. Those are the
   * company's own files, so the residual exposure is someone re-surfacing a
   * known key, not an arbitrary external URL — which is the attack this is
   * for.
   */
  isOwnAssetUrl(url: string): boolean {
    if (!this.enabled) return false;
    return url.startsWith(assetUrlForKey(this.bucket, this.region, ""));
  }

  /**
   * Mint a one-off PUT URL for a file, plus the public URL to store on the row.
   *
   * The key is built here, never accepted from the client: the bucket is flat,
   * so a client-chosen key could name — and overwrite — any object in it. The
   * content type and the exact byte length are signed into the URL, so S3
   * rejects a PUT whose Content-Type or Content-Length does not match what was
   * approved — and the length was capped by the contract. The browser sets
   * Content-Length itself from the `File` body (`useFileUpload`), so the
   * client must report `file.size` exactly. The TTL bounds the rest: five
   * minutes, one key, one type, one size.
   *
   * The parameter takes either upload contract: the two scan fields' narrow
   * `CreateUploadInput`, and chat's wider `ChatUploadInput`, whose allowlist
   * adds the office documents a notice carries (docs/chat-plan.md §2). Each
   * caller's own procedure input is what pins which types it will accept —
   * widening here does not widen either of them, and nothing about the gate
   * changes: the key is still built below and the type still signed into the
   * PUT, whatever it is.
   */
  async createUpload(
    input: CreateUploadInput | ChatUploadInput,
  ): Promise<CreateUploadResult> {
    const client = this.client;
    if (client === null) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "File uploads are not configured on this server",
      });
    }

    const key = assetKey(input.filename);
    const uploadUrl = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: input.contentType,
        ContentLength: input.size,
      }),
      {
        expiresIn: UPLOAD_URL_TTL_SECONDS,
        // `ContentType` alone is NOT a constraint: the presigner hoists it into
        // the query string, where S3 treats it as advisory, and a PUT sending
        // `text/html` against a URL minted for `application/pdf` is accepted
        // and served back as text/html. On a world-readable bucket that is a
        // script-bearing page hosted on an amazonaws.com domain. Signing the
        // header makes the type part of the signature, so a mismatched PUT
        // fails with SignatureDoesNotMatch. Verified both ways.
        // Content-Length likewise: signed, it turns the contract's size cap
        // into an S3-enforced one instead of a client promise.
        signableHeaders: new Set(["content-type", "content-length"]),
      },
    );

    return {
      uploadUrl,
      url: assetUrlForKey(this.bucket, this.region, key),
      key,
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    };
  }
}
