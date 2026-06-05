import { useState } from "react";
import type { ShipmentComment } from "../../../api/shipments";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { fmtDateTime } from "../../../utils/date";
import { MessageSquare, Plus } from "lucide-react";

interface CommentsListProps {
  comments: ShipmentComment[];
  newComment: string;
  onNewCommentChange: (value: string) => void;
  addingComment: boolean;
  canAdd: boolean;
  onAddComment: () => void;
}

export function CommentsList({
  comments,
  newComment,
  onNewCommentChange,
  addingComment,
  canAdd,
  onAddComment,
}: CommentsListProps) {
  const [expanded, setExpanded] = useState(false);

  const handleSubmit = async () => {
    await onAddComment();
    setExpanded(false);
  };

  return (
    <Card className="cursor-default">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4" />
          Comentarios
          {comments.length > 0 && (
            <span className="text-[11px] font-normal text-[var(--text-muted)] ml-auto">
              {comments.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {comments.length === 0 && !expanded ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <div className="w-10 h-10 rounded-full bg-[var(--bg-muted)] flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-[var(--text-muted)]" />
            </div>
            <p className="text-[var(--text-muted)] text-[13px] m-0">
              Sin comentarios todavía.
            </p>
            {canAdd && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setExpanded(true)}
                className="mt-1 gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Agregar comentario
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2.5 max-h-[320px] overflow-y-auto mb-3">
              {comments.map((c) => (
                <div
                  key={c.id}
                  className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3 text-[13px] transition-colors duration-200 hover:border-[var(--border-strong)]"
                >
                  <div className="flex justify-between items-baseline mb-1.5">
                    <span className="font-semibold text-[var(--text-primary)]">
                      {c.author}
                    </span>
                    <span className="text-[var(--text-muted)] text-[11px]">
                      {fmtDateTime(c.created_at)}
                    </span>
                  </div>
                  <p className="m-0 text-[var(--text-strong)] whitespace-pre-wrap leading-relaxed">
                    {c.body}
                  </p>
                </div>
              ))}
            </div>

            {canAdd && !expanded && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setExpanded(true)}
                className="gap-1.5 w-full justify-center"
              >
                <Plus className="w-3.5 h-3.5" />
                Agregar comentario
              </Button>
            )}

            {canAdd && expanded && (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newComment}
                  onChange={(e) => onNewCommentChange(e.target.value)}
                  placeholder="Escribí un comentario..."
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newComment.trim() && !addingComment) {
                      handleSubmit();
                    }
                    if (e.key === "Escape") {
                      setExpanded(false);
                      onNewCommentChange("");
                    }
                  }}
                  className="flex-1 px-3 py-2 rounded-lg border border-[var(--border-strong)] text-sm bg-[var(--bg-card)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                />
                <Button
                  size="sm"
                  onClick={handleSubmit}
                  disabled={addingComment || !newComment.trim()}
                  className="shrink-0"
                >
                  {addingComment ? "..." : "Enviar"}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
