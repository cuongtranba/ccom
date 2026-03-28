import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function App() {
  return (
    <div className="mx-auto max-w-[860px] p-8">
      <h1 className="text-2xl font-bold">
        inv-server <span className="text-primary">command post</span>
      </h1>
      <Card className="mt-4 border-border bg-card">
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-widest text-muted-foreground">
            Theme Check
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button>Spice Button</Button>
        </CardContent>
      </Card>
    </div>
  );
}
