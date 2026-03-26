import Anthropic from "@anthropic-ai/sdk";
import type { Engine } from "./engine";
import type { Store } from "./store";
import type { NodeConfig } from "./config";
import type { ItemKind } from "@inv/shared";

interface ToolInput {
  itemId?: string;
  evidence?: string;
  kind?: string;
  title?: string;
  body?: string;
  externalRef?: string;
}

export class Agent {
  private client: Anthropic;
  private messages: Anthropic.MessageParam[] = [];

  constructor(
    private engine: Engine,
    private store: Store,
    private config: NodeConfig,
  ) {
    this.client = new Anthropic();
  }

  get tools(): Anthropic.Tool[] {
    return [
      {
        name: "list_items",
        description:
          "List all inventory items in the current node. Returns an array of items with their id, kind, title, state, and other metadata.",
        input_schema: {
          type: "object" as const,
          properties: {},
        },
      },
      {
        name: "verify_item",
        description:
          "Verify an inventory item, transitioning it from unverified to proven, or re-verifying a suspect item. Requires the item ID and evidence describing why the item is verified.",
        input_schema: {
          type: "object" as const,
          properties: {
            itemId: {
              type: "string",
              description: "The UUID of the item to verify",
            },
            evidence: {
              type: "string",
              description:
                "Evidence or reason for verifying the item",
            },
          },
          required: ["itemId", "evidence"],
        },
      },
      {
        name: "add_item",
        description:
          "Add a new inventory item to the current node. Requires a kind and title. Optionally accepts a body and external reference.",
        input_schema: {
          type: "object" as const,
          properties: {
            kind: {
              type: "string",
              description:
                "The kind of item: adr, api-spec, data-model, tech-design, epic, user-story, prd, screen-spec, user-flow, test-case, test-plan, runbook, bug-report, decision, or custom",
              enum: [
                "adr",
                "api-spec",
                "data-model",
                "tech-design",
                "epic",
                "user-story",
                "prd",
                "screen-spec",
                "user-flow",
                "test-case",
                "test-plan",
                "runbook",
                "bug-report",
                "decision",
                "custom",
              ],
            },
            title: {
              type: "string",
              description: "Title of the item",
            },
            body: {
              type: "string",
              description: "Optional body/description of the item",
            },
            externalRef: {
              type: "string",
              description:
                "Optional external reference (e.g. a URL or ticket ID)",
            },
          },
          required: ["kind", "title"],
        },
      },
      {
        name: "audit",
        description:
          "Audit the current node's inventory health. Returns counts of items by state (unverified, proven, suspect, broke), orphans without traces, and items missing upstream references.",
        input_schema: {
          type: "object" as const,
          properties: {},
        },
      },
      {
        name: "impact",
        description:
          "Check what downstream items would be affected if a given item changes. Returns a list of all items that depend on the specified item, directly or transitively.",
        input_schema: {
          type: "object" as const,
          properties: {
            itemId: {
              type: "string",
              description: "The UUID of the item to check impact for",
            },
          },
          required: ["itemId"],
        },
      },
      {
        name: "status",
        description:
          "Get a summary of item counts by state for the current node. Shows how many items are unverified, proven, suspect, and broke.",
        input_schema: {
          type: "object" as const,
          properties: {},
        },
      },
    ];
  }

  async chat(userMessage: string): Promise<string> {
    this.messages.push({ role: "user", content: userMessage });

    const systemPrompt = `You are an inventory management assistant for the Constitution framework.
You help manage a node called "${this.config.node.name}" (vertical: ${this.config.node.vertical}, project: ${this.config.node.project}).
Node ID: ${this.config.node.id}

You can list items, verify them, add new ones, run audits, check impact, and get status summaries.
When the user asks about their inventory, use the available tools to get real data.
Be concise and helpful. Format results clearly.`;

    for (;;) {
      const response = await this.client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: systemPrompt,
        tools: this.tools,
        messages: this.messages,
      });

      if (response.stop_reason === "tool_use") {
        // Collect all tool use blocks from the response
        const toolUseBlocks = response.content.filter(
          (block): block is Anthropic.ToolUseBlock =>
            block.type === "tool_use",
        );

        // Add the assistant message with all content blocks
        this.messages.push({ role: "assistant", content: response.content });

        // Execute each tool and collect results
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const toolUse of toolUseBlocks) {
          const result = this.executeTool(
            toolUse.name,
            toolUse.input as ToolInput,
          );
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: result.content,
          });
        }

        // Add tool results as a single user message
        this.messages.push({ role: "user", content: toolResults });
        continue;
      }

      // Extract text from the response
      this.messages.push({ role: "assistant", content: response.content });

      const textBlocks = response.content.filter(
        (block): block is Anthropic.TextBlock => block.type === "text",
      );
      return textBlocks.map((b) => b.text).join("\n");
    }
  }

  private executeTool(
    name: string,
    input: ToolInput,
  ): { content: string } {
    try {
      switch (name) {
        case "list_items": {
          const items = this.engine.listItems(this.config.node.id);
          return { content: JSON.stringify(items, null, 2) };
        }

        case "verify_item": {
          if (!input.itemId || !input.evidence) {
            return { content: "Error: itemId and evidence are required" };
          }
          const signals = this.engine.verifyItem(
            input.itemId,
            input.evidence,
            this.config.node.owner,
          );
          return {
            content: JSON.stringify(
              {
                verified: true,
                itemId: input.itemId,
                signalsPropagated: signals.length,
              },
              null,
              2,
            ),
          };
        }

        case "add_item": {
          if (!input.kind || !input.title) {
            return { content: "Error: kind and title are required" };
          }
          const item = this.engine.addItem(
            this.config.node.id,
            input.kind as ItemKind,
            input.title,
            input.body,
            input.externalRef,
          );
          return { content: JSON.stringify(item, null, 2) };
        }

        case "audit": {
          const report = this.engine.audit(this.config.node.id);
          return { content: JSON.stringify(report, null, 2) };
        }

        case "impact": {
          if (!input.itemId) {
            return { content: "Error: itemId is required" };
          }
          const impacted = this.engine.impact(input.itemId);
          return { content: JSON.stringify(impacted, null, 2) };
        }

        case "status": {
          const items = this.engine.listItems(this.config.node.id);
          const summary = {
            total: items.length,
            unverified: items.filter((i) => i.state === "unverified").length,
            proven: items.filter((i) => i.state === "proven").length,
            suspect: items.filter((i) => i.state === "suspect").length,
            broke: items.filter((i) => i.state === "broke").length,
          };
          return { content: JSON.stringify(summary, null, 2) };
        }

        default:
          return { content: `Error: unknown tool "${name}"` };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Error: ${message}` };
    }
  }
}
