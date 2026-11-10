import { useEffect, useState } from "react";
import { fetchAgents } from "../lib/transactions";
import RadioGroup from "./RadioGroup";

export const isBroker = (agent) => agent.role === "broker";
// Broker or transaction coordinator — both work across every agent's deals.
const canPickAgent = (agent) => agent.role === "broker" || agent.role === "coordinator";

/**
 * Brokers can submit on behalf of any agent; regular agents are locked to themselves,
 * matching how the app restricts data access everywhere else.
 */
export default function AgentField({ currentAgent, value, onChange }) {
  const [agents, setAgents] = useState([]);

  useEffect(() => {
    if (canPickAgent(currentAgent)) {
      fetchAgents().then(setAgents).catch(() => {});
    }
  }, [currentAgent]);

  if (!canPickAgent(currentAgent)) {
    return (
      <div className="uc-agent-display">
        Agent <strong>{currentAgent.name}</strong>
      </div>
    );
  }

  return (
    <fieldset>
      <legend>Agent</legend>
      <RadioGroup
        name="agent"
        value={value}
        onChange={(id) => onChange(id, agents.find((a) => a.id === id)?.name)}
        options={agents.map((a) => ({ value: a.id, label: a.name }))}
      />
    </fieldset>
  );
}
