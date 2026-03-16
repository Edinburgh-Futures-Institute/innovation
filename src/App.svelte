<script>
  import { onMount } from "svelte";
  import { hierarchy, pack } from "d3";
  import { cubicInOut } from "svelte/easing";
  import { tweened } from "svelte/motion";
  import {
    GROUPING_OPTIONS,
    groupedActivities,
    isLoading,
    loadCsvFile,
    loadDefaultCsv,
    selectedGrouping,
    sourceLabel,
    uploadError,
  } from "./lib/activityStore";

  const CIRCLE_FILL = "rgba(0, 0, 0, 0.3)";
  const CIRCLE_STROKE = "black";

  const MIN_CHART_WIDTH = 280;
  const MIN_CHART_HEIGHT = 220;
  const GRID_GAP = 16;
  const ZOOM_DURATION_MS = 560;
  const ROOT_ID = "root";
  const ACTIVITY_LABEL_MIN_RADIUS = 8;

  let mainWidth = 0;
  let mainHeight = 0;
  let panelHeight = 0;

  let selectedGroupKey = "";
  let lastGroupingValue = "";

  let focusId = ROOT_ID;
  let appliedLayoutSignature = "";
  let appliedFocusId = ROOT_ID;
  let hasInitializedZoom = false;

  const zoomView = tweened([0, 0, 1], {
    duration: ZOOM_DURATION_MS,
    easing: cubicInOut,
  });

  onMount(() => {
    loadDefaultCsv();
  });

  $: shellPadding = clamp(16, mainWidth * 0.025, 25.6);
  $: chartWidth = Math.max(
    MIN_CHART_WIDTH,
    Math.floor(mainWidth - shellPadding * 2),
  );
  $: chartHeight = Math.max(
    MIN_CHART_HEIGHT,
    Math.floor(mainHeight - panelHeight - GRID_GAP - shellPadding * 2),
  );

  $: if (lastGroupingValue !== $selectedGrouping) {
    selectedGroupKey = "";
    lastGroupingValue = $selectedGrouping;
  }

  $: hierarchyData = buildHierarchyData($groupedActivities);

  $: currentHeading =
    hierarchyData.children.find((group) => group.key === selectedGroupKey)
      ?.name ?? "Innovation";

  $: if (
    selectedGroupKey &&
    !hierarchyData.children.some((group) => group.key === selectedGroupKey)
  ) {
    selectedGroupKey = "";
  }

  $: hierarchySignature = buildHierarchySignature(
    hierarchyData,
    chartWidth,
    chartHeight,
  );

  $: packed = computePackedNodes(hierarchyData, chartWidth, chartHeight);
  $: nodeById = new Map(packed.nodes.map((node) => [node.id, node]));
  $: targetFocusId = selectedGroupKey ? `group:${selectedGroupKey}` : ROOT_ID;

  $: if (focusId !== targetFocusId) {
    focusId = targetFocusId;
  }

  $: syncZoomToFocus(nodeById, packed.root, hierarchySignature, focusId);

  $: renderedNodes = projectNodes(
    packed.nodes,
    $zoomView,
    chartWidth,
    chartHeight,
  );

  async function handleCsvUpload(event) {
    const input = event.currentTarget;
    const [file] = input.files ?? [];
    if (!file) {
      return;
    }

    await loadCsvFile(file);
    input.value = "";
  }

  function handleGroupClick(event, node) {
    event.stopPropagation();

    if (selectedGroupKey === node.key) {
      selectedGroupKey = "";
    } else {
      selectedGroupKey = node.key;
    }
  }

  function handleGroupKeydown(event, node) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    handleGroupClick(event, node);
  }

  function handleActivityClick(event, node) {
    event.stopPropagation();

    if (!node.groupKey) {
      return;
    }

    if (selectedGroupKey === node.groupKey) {
      selectedGroupKey = "";
    } else {
      selectedGroupKey = node.groupKey;
    }
  }

  function handleActivityKeydown(event, node) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    handleActivityClick(event, node);
  }

  function handleRootClick(event) {
    event.stopPropagation();

    if (selectedGroupKey) {
      selectedGroupKey = "";
    }
  }

  function handleRootKeydown(event) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    handleRootClick(event);
  }

  function syncZoomToFocus(nodeLookup, rootNode, signature, currentFocusId) {
    if (!rootNode) {
      hasInitializedZoom = false;
      appliedLayoutSignature = "";
      appliedFocusId = ROOT_ID;
      return;
    }

    const focusNode = nodeLookup.get(currentFocusId) ?? rootNode;
    const nextView = [focusNode.x, focusNode.y, Math.max(focusNode.r * 2.1, 1)];

    if (!hasInitializedZoom || appliedLayoutSignature !== signature) {
      zoomView.set(nextView, { duration: 0 });
      hasInitializedZoom = true;
      appliedLayoutSignature = signature;
      appliedFocusId = focusNode.id;
      return;
    }

    if (appliedFocusId !== focusNode.id) {
      zoomView.set(nextView);
      appliedFocusId = focusNode.id;
    }
  }

  function clamp(min, value, max) {
    return Math.min(max, Math.max(min, value));
  }

  function buildHierarchyData(groups) {
    return {
      id: ROOT_ID,
      name: "Innovation",
      children: groups.map((group) => ({
        id: `group:${group.key}`,
        key: group.key,
        name: group.label,
        children: group.activities.map((activity) => ({
          id: `activity:${group.key}:${activity.id}`,
          name: activity.name,
          value: activity.value,
        })),
      })),
    };
  }

  function buildHierarchySignature(data, width, height) {
    const groupSignature = data.children
      .map((group) => {
        const total = group.children.reduce(
          (sum, child) => sum + child.value,
          0,
        );
        return `${group.id}:${group.children.length}:${total}`;
      })
      .join("|");

    return `${width}:${height}:${groupSignature}`;
  }

  function computePackedNodes(data, width, height) {
    if (!data.children.length) {
      return { root: null, nodes: [] };
    }

    const safeWidth = Math.max(MIN_CHART_WIDTH, width || MIN_CHART_WIDTH);
    const safeHeight = Math.max(MIN_CHART_HEIGHT, height || MIN_CHART_HEIGHT);

    const root = hierarchy(data)
      .sum((d) => d.value ?? 0)
      .sort((a, b) => b.value - a.value);

    const packed = pack().size([safeWidth, safeHeight]).padding(8)(root);

    const nodes = packed.descendants().map((node, index) => ({
      id: node.data.id,
      depth: node.depth,
      key: node.data.key ?? "",
      groupKey:
        node.depth === 1
          ? (node.data.key ?? "")
          : node.depth >= 2
            ? (node.parent?.data?.key ?? "")
            : "",
      groupLabel:
        node.depth >= 2
          ? (node.parent?.data?.name ?? "")
          : node.depth === 1
            ? node.data.name
            : "Innovation",
      name: node.data.name,
      value: node.value ?? 0,
      x: node.x,
      y: node.y,
      r: node.r,
      fill: CIRCLE_FILL,
      stroke: CIRCLE_STROKE,
      index,
    }));

    return {
      root: packed,
      nodes,
    };
  }

  function projectNodes(nodes, view, width, height) {
    if (!nodes.length) {
      return [];
    }

    const [viewX, viewY, viewDiameter] = view;
    const diameter = Math.min(width, height);
    const scale = diameter / Math.max(viewDiameter, 1);

    return nodes
      .map((node) => {
        const screenX = (node.x - viewX) * scale + width / 2;
        const screenY = (node.y - viewY) * scale + height / 2;
        const screenR = node.r * scale;

        const inFrame =
          screenX + screenR >= 0 &&
          screenX - screenR <= width &&
          screenY + screenR >= 0 &&
          screenY - screenR <= height;

        return {
          ...node,
          screenX,
          screenY,
          screenR,
          inFrame,
        };
      })
      .filter((node) => node.inFrame && node.screenR > 1.25);
  }

  function shouldShowRootLabel(node) {
    return node.depth === 0 && !selectedGroupKey && node.screenR > 52;
  }

  function shouldShowGroupLabel(node) {
    return (
      node.depth === 1 &&
      !selectedGroupKey &&
      (node.screenR > 30 || node.value <= 1)
    );
  }

  function shouldShowGroupSubtitle(node) {
    return shouldShowGroupLabel(node) && node.screenR > 56;
  }

  function shouldShowActivityLabel(node) {
    return (
      node.depth === 2 &&
      Boolean(selectedGroupKey) &&
      node.groupKey === selectedGroupKey &&
      node.screenR >= ACTIVITY_LABEL_MIN_RADIUS
    );
  }

  function formatNodeTitle(node) {
    if (node.depth === 0 || node.depth === 1) {
      return `${node.name}: ${Math.round(node.value)} total`;
    }

    return node.name;
  }

  function formatNodeLabel(node) {
    return shortLabel(node.name, node.screenR, node.depth);
  }

  function shortLabel(name, radius, depth = 2) {
    const tuning = depth === 1 ? 2.7 : 3.1;
    const minChars = depth === 2 ? 4 : 6;
    const maxChars = Math.max(minChars, Math.floor(radius / tuning));
    if (name.length <= maxChars) {
      return name;
    }

    return `${name.slice(0, Math.max(5, maxChars - 3))}...`;
  }

  function buildNodeClass(node) {
    const depthClass = `depth-${node.depth}`;
    const nodeTypeClass =
      node.depth === 0
        ? "root-node"
        : node.depth === 1
          ? "group-node"
          : "activity-node";
    const focusClass =
      node.depth === 1 && selectedGroupKey === node.key ? "is-focused" : "";

    return `node ${depthClass} ${nodeTypeClass} ${focusClass}`.trim();
  }

  function isFocusedGroup(node) {
    return node.depth === 1 && selectedGroupKey === node.key;
  }

  function formatGroupSubtitle(node) {
    return `${Math.round(node.value)} total`;
  }

  function groupAriaLabel(node) {
    if (isFocusedGroup(node)) {
      return `${node.name}, selected. Activate to zoom out.`;
    }

    return `Zoom to ${node.name}`;
  }

  function activityAriaLabel(node) {
    if (selectedGroupKey === node.groupKey) {
      return `${node.name}, in selected group. Activate to zoom out.`;
    }

    if (node.groupLabel) {
      return `${node.name}. Activate to zoom to ${node.groupLabel}.`;
    }

    return `Zoom from ${node.name}`;
  }

  function rootAriaLabel() {
    if (!selectedGroupKey) {
      return "Innovation root group";
    }

    return "Zoom out to Innovation";
  }
</script>

<main class="page" bind:clientWidth={mainWidth} bind:clientHeight={mainHeight}>
  <header
    class="panel"
    bind:clientHeight={panelHeight}
    style="text-align: center;"
  >
    <div class="controls">
      <div class="controls-left">
        <label class="filter">
          <span>Group by</span>
          <select bind:value={$selectedGrouping}>
            {#each GROUPING_OPTIONS as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </label>
      </div>

      <div class="controls-right">
        <label class="upload">
          <span>Load CSV</span>
          <input type="file" accept=".csv,text/csv" on:change={handleCsvUpload} />
        </label>

        <p class="source">Source: {$sourceLabel}</p>


        {#if $uploadError}
          <p class="error">{$uploadError}</p>
        {/if}
      </div>
    </div>

    <h1>{currentHeading}</h1>
  </header>

  <section class="viz-shell">
    {#if $isLoading}
      <p class="empty-state">Loading activities...</p>
    {:else if renderedNodes.length}
      <svg
        width={chartWidth}
        height={chartHeight}
        role="img"
        aria-label="Zoomable circle packing grouped by selected dimension"
      >
        {#each renderedNodes as node (node.id)}
          {#if node.depth === 0}
            <g
              class={buildNodeClass(node)}
              style={`--idx:${node.index};`}
              transform={`translate(${node.screenX}, ${node.screenY})`}
              role="button"
              tabindex="0"
              aria-label={rootAriaLabel()}
              on:click={handleRootClick}
              on:keydown={handleRootKeydown}
            >
              <circle
                r={node.screenR}
                fill={"#d9d9d9"}
                stroke={node.stroke}
                stroke-width="0.5"
              >
                <title>{formatNodeTitle(node)}</title>
              </circle>
            </g>
          {:else if node.depth === 1}
            <g
              class={buildNodeClass(node)}
              style={`--idx:${node.index};`}
              transform={`translate(${node.screenX}, ${node.screenY})`}
              role="button"
              tabindex="0"
              aria-label={groupAriaLabel(node)}
              on:click={(event) => handleGroupClick(event, node)}
              on:keydown={(event) => handleGroupKeydown(event, node)}
            >
              <circle
                r={node.screenR}
                fill={"#cccccc"}
                stroke={node.stroke}
                stroke-width="0.5"
              >
                <title>{formatNodeTitle(node)}</title>
              </circle>
            </g>
          {:else}
            <g
              class={buildNodeClass(node)}
              style={`--idx:${node.index};`}
              transform={`translate(${node.screenX}, ${node.screenY})`}
              role="button"
              tabindex="0"
              aria-label={activityAriaLabel(node)}
              on:click={(event) => handleActivityClick(event, node)}
              on:keydown={(event) => handleActivityKeydown(event, node)}
            >
              <circle
                r={node.screenR}
                fill={"#737373"}
                stroke={node.stroke}
                stroke-width="0.5"
              >
                <title>{formatNodeTitle(node)}</title>
              </circle>

              {#if shouldShowActivityLabel(node)}
                <text
                  class="label activity-label"
                  text-anchor="middle"
                  dy="0.35em"
                >
                  {formatNodeLabel(node)}
                </text>
              {/if}
            </g>
          {/if}
        {/each}

        {#each renderedNodes as node (`label:${node.id}`)}
          {#if node.depth === 0 && shouldShowRootLabel(node)}
            <g
              class="label-layer"
              transform={`translate(${node.screenX}, ${node.screenY})`}
            >
              <text
                class="label root-label"
                text-anchor="middle"
                y={-node.screenR + 10}
                dominant-baseline="hanging"
              >
                {node.name}
              </text>
            </g>
          {:else if node.depth === 1 && shouldShowGroupLabel(node)}
            <g
              class="label-layer"
              transform={`translate(${node.screenX}, ${node.screenY})`}
            >
              <text class="label group-label" text-anchor="middle" dy="-0.15em">
                {formatNodeLabel(node)}
              </text>

              {#if shouldShowGroupSubtitle(node)}
                <text class="group-subtitle" text-anchor="middle" dy="1.25em">
                  {formatGroupSubtitle(node)}
                </text>
              {/if}
            </g>
          {/if}
        {/each}
      </svg>

      {#if selectedGroupKey}
        <p class="zoom-hint">Click the Innovation circle to zoom back out.</p>
      {/if}
    {:else}
      <p class="empty-state">
        No activities were found in the current dataset.
      </p>
    {/if}
  </section>
</main>
