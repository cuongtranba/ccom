import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface AuthGateProps {
  adminKey: string;
  onKeyChange: (key: string) => void;
  isAuthed: boolean;
}

export function AuthGate({ adminKey, onKeyChange, isAuthed }: AuthGateProps) {
  return (
    <div
      className={`mb-10 flex items-end gap-3 border-l-2 bg-card p-5 ${
        isAuthed ? "border-success" : "border-border"
      }`}
    >
      <div className="flex-1">
        <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
          Admin Key
        </label>
        <Input
          type="password"
          placeholder="Enter ADMIN_KEY to authenticate"
          value={adminKey}
          onChange={(e) => onKeyChange(e.target.value)}
          className="border-border bg-background font-mono text-sm"
          autoComplete="off"
        />
      </div>
      <Badge
        variant={isAuthed ? "default" : "secondary"}
        className={`mb-1 ${isAuthed ? "bg-success text-success-foreground" : ""}`}
      >
        {isAuthed ? "ready" : "not authenticated"}
      </Badge>
    </div>
  );
}
