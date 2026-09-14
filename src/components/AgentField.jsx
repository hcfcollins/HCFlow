import { useEffect, useState } from "react";
import { fetchAgents } from "../lib/transactions";
import RadioGroup from "./RadioGroup";

export const isBroker = (agent) => agent.role === "broker";

/**
 * Brokers can submit on behalf of any agent; regular agents are locked to themselves,
 * matching how the app restricts data access everywhere else.
 */
export default function AgentField({ currentAgent, value, onChange }) {
  const [agents, setAgents] = useState([]);

  useEffect(() => {
    if (isBroker(currentAgent)) {
      fetchAgents().then(setAgents).catch(() => {});
    }
  }, [currentAgent]);

  if (!isBroker(currentAgent)) {
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
