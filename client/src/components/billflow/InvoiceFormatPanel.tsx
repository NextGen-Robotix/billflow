import { useEffect, useState } from "react";
import {
  Eye,
  FileUp,
  LoaderCircle,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const MAX_PDF_BYTES = 8 * 1024 * 1024;

async function fileToBase64(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read this PDF file."));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

export function InvoiceFormatPanel({ canEdit }: { canEdit: boolean }) {
  const utils = trpc.useUtils();
  const format = trpc.documentFormat.get.useQuery();
  const [top, setTop] = useState("38");
  const [bottom, setBottom] = useState("24");
  const [file, setFile] = useState<File | null>(null);
  const [remove, setRemove] = useState(false);
  const [localBase64, setLocalBase64] = useState("");
  const [fileReadError, setFileReadError] = useState("");
  const [a4PreviewUrl, setA4PreviewUrl] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const letterheadBytes = trpc.documentFormat.letterheadBytes.useQuery(
    undefined,
    {
      enabled: !file && !remove && !!format.data?.format.letterheadKey,
      staleTime: 60_000,
    }
  );
  const save = trpc.documentFormat.save.useMutation({
    onSuccess: async () => {
      toast.success("Document format saved");
      await Promise.all([
        utils.documentFormat.get.invalidate(),
        utils.documentFormat.letterheadBytes.invalidate(),
      ]);
      setFile(null);
      setRemove(false);
    },
    onError: error => toast.error(error.message),
  });

  useEffect(() => {
    if (!format.data) return;
    setTop(String(format.data.format.reservedTopMm));
    setBottom(String(format.data.format.reservedBottomMm));
  }, [format.data?.format.reservedTopMm, format.data?.format.reservedBottomMm]);

  useEffect(() => {
    if (!file) {
      setLocalBase64("");
      setFileReadError("");
      return;
    }
    let cancelled = false;
    setLocalBase64("");
    setFileReadError("");
    void fileToBase64(file)
      .then(value => {
        if (!cancelled) setLocalBase64(value);
      })
      .catch(error => {
        if (!cancelled)
          setFileReadError(
            error instanceof Error
              ? error.message
              : "Could not read this PDF file."
          );
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  const hasSavedLetterhead = !!format.data?.format.letterheadKey;
  const previewBase64 = file
    ? localBase64 || null
    : remove
      ? null
      : (letterheadBytes.data?.base64 ?? null);
  const waitingForSource = file
    ? !localBase64 && !fileReadError
    : !remove && hasSavedLetterhead && letterheadBytes.isLoading;
  const previewSourceError = file
    ? fileReadError
    : remove
      ? ""
      : (letterheadBytes.error?.message ?? "");

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    setA4PreviewUrl("");
    setPreviewError("");

    if (!previewBase64) {
      setPreviewLoading(waitingForSource);
      if (previewSourceError) setPreviewError(previewSourceError);
      return () => {
        cancelled = true;
      };
    }

    setPreviewLoading(true);
    void (async () => {
      try {
        const sourceBytes = Uint8Array.from(atob(previewBase64), character =>
          character.charCodeAt(0)
        );
        const { normalizePdfToPortraitA4 } = await import("@/lib/a4Canvas");
        const normalizedBytes = await normalizePdfToPortraitA4(sourceBytes);
        const blob = new Blob([normalizedBytes.slice().buffer as ArrayBuffer], {
          type: "application/pdf",
        });
        objectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setA4PreviewUrl(objectUrl);
      } catch (error) {
        if (!cancelled)
          setPreviewError(
            error instanceof Error
              ? error.message
              : "The letterhead could not be fitted to the A4 canvas."
          );
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewBase64, previewSourceError, waitingForSource]);

  function selectFile(selected: File | undefined) {
    if (!selected) return;
    if (selected.type !== "application/pdf" || selected.size > MAX_PDF_BYTES) {
      toast.error("Choose a PDF file no larger than 8 MB.");
      return;
    }
    setRemove(false);
    setFile(selected);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const upper = Number(top);
    const lower = Number(bottom);
    if (upper + lower > 160) {
      toast.error("Combined reserved space cannot exceed 160 mm.");
      return;
    }
    try {
      save.mutate({
        reservedTopMm: upper,
        reservedBottomMm: lower,
        letterheadBase64: file ? await fileToBase64(file) : undefined,
        removeLetterhead: remove,
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not read this letterhead PDF."
      );
    }
  }

  const previewMessage = previewError
    ? previewError
    : previewLoading
      ? "Preparing every page on a portrait A4 canvas…"
      : "No letterhead uploaded yet. This is a blank portrait A4 canvas.";

  return (
    <section className="document-format-page">
      <div className="section-toolbar">
        <div>
          <div className="eyebrow">DOCUMENT DESIGN</div>
          <h2>Invoice Format</h2>
          <p>
            Use your PDF letterhead behind invoices, quotations and delivery
            challans.
          </p>
        </div>
        <span className="format-private">
          <ShieldCheck size={14} /> Business workspace
        </span>
      </div>
      <div className="format-layout">
        <article className="section-panel format-settings-card">
          <div className="eyebrow">LETTERHEAD SETTINGS</div>
          <h3>Page background</h3>
          <p>
            The canvas is always portrait A4 (210 × 297 mm). Every uploaded PDF
            page is fitted to A4 without stretching, and content is kept clear
            of the top and bottom letterhead areas on every exported page.
          </p>
          <form className="format-form" onSubmit={submit}>
            <label className="letterhead-drop">
              <span className="file-up-icon">
                <FileUp size={19} />
              </span>
              <b>
                {file
                  ? file.name
                  : hasSavedLetterhead && !remove
                    ? "Replace PDF letterhead"
                    : "Upload PDF letterhead"}
              </b>
              <small>PDF only · maximum 8 MB</small>
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={event => selectFile(event.target.files?.[0])}
                disabled={!canEdit}
              />
            </label>
            <div className="format-margins-grid">
              <label>
                Reserved upper area
                <input
                  type="number"
                  min="0"
                  max="120"
                  step="1"
                  value={top}
                  disabled={!canEdit}
                  onChange={event => setTop(event.target.value)}
                />
                <small>Millimetres from top</small>
              </label>
              <label>
                Reserved lower area
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={bottom}
                  disabled={!canEdit}
                  onChange={event => setBottom(event.target.value)}
                />
                <small>Millimetres from bottom</small>
              </label>
            </div>
            <div className="format-safe-preview">
              <div className="safe-zone safe-zone-top">
                <span>Reserved letterhead</span>
              </div>
              <div className="safe-zone-content">
                <i />
                {Array.from({ length: 5 }, (_, index) => (
                  <i key={index} />
                ))}
                <span>Document content appears in this area</span>
              </div>
              <div className="safe-zone safe-zone-bottom">
                <span>Reserved letterhead</span>
              </div>
            </div>
            {hasSavedLetterhead && canEdit && (
              <button
                type="button"
                className="quiet-btn remove-letterhead"
                onClick={() => {
                  setFile(null);
                  setRemove(true);
                }}
              >
                <Trash2 size={14} /> Remove saved PDF
              </button>
            )}
            <div className="format-note">
              <ShieldCheck size={16} />
              <span>
                The original PDF is stored in project storage. Its preview and
                all generated documents use a fixed portrait A4 canvas; only
                workspace admins can change this format.
              </span>
            </div>
            {canEdit && (
              <button
                className="primary-btn"
                disabled={save.isPending || Number(top) + Number(bottom) > 160}
              >
                {save.isPending ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Save size={16} />
                )}{" "}
                Save format
              </button>
            )}
          </form>
        </article>
        <article className="section-panel format-preview-card">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">LIVE A4 CANVAS</div>
              <h3>
                {file
                  ? "Selected letterhead on A4"
                  : hasSavedLetterhead && !remove
                    ? "Saved letterhead on A4"
                    : "Portrait A4 blank template"}
              </h3>
            </div>
            <Eye size={17} />
          </div>
          <div
            className="letterhead-a4-canvas"
            aria-label="Portrait A4 letterhead preview canvas"
          >
            {a4PreviewUrl ? (
              <iframe
                title="Portrait A4 letterhead preview"
                className="letterhead-frame"
                src={a4PreviewUrl}
              />
            ) : (
              <div
                className={`letterhead-a4-empty${previewError ? " has-error" : ""}`}
                role="status"
              >
                {previewLoading && <LoaderCircle className="spin" size={22} />}
                <b>{previewError ? "Preview unavailable" : "A4 PORTRAIT"}</b>
                <span>{previewMessage}</span>
                <small>210 × 297 mm</small>
              </div>
            )}
          </div>
          <div className="format-a4-caption">
            Every uploaded letterhead page is centered on this fixed portrait A4
            canvas. The original file remains unchanged in storage.
          </div>
          <div className="format-apply-list">
            <span>Applied to</span>
            <b>Invoices</b>
            <b>Quotations</b>
            <b>Delivery challans</b>
          </div>
        </article>
      </div>
    </section>
  );
}
