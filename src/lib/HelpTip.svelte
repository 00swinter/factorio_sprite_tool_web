<script lang="ts" module>
  let dismissCurrent: (() => void) | null = null
</script>

<script lang="ts">
  import type { Snippet } from 'svelte'

  let { label, children }: { label: string; children: Snippet } = $props()

  const tipId = $props.id()

  let root: HTMLSpanElement | undefined = $state()
  let pop: HTMLSpanElement | undefined = $state()
  let open = $state(false)
  let pinned = $state(false)
  let placed = $state(false)
  let popStyle = $state('')
  let hideTimer = 0

  function forceClose() {
    window.clearTimeout(hideTimer)
    pinned = false
    open = false
    placed = false
    if (dismissCurrent === forceClose) dismissCurrent = null
  }

  function place() {
    if (!root || !pop) return
    const anchor = root.getBoundingClientRect()
    const width = pop.offsetWidth
    const height = pop.offsetHeight
    const margin = 8
    const gap = 6
    let left = anchor.left
    let top = anchor.bottom + gap
    if (left + width > window.innerWidth - margin) {
      left = window.innerWidth - margin - width
    }
    if (left < margin) left = margin
    if (top + height > window.innerHeight - margin) {
      const above = anchor.top - gap - height
      if (above >= margin) top = above
    }
    popStyle = `left:${Math.round(left)}px;top:${Math.round(top)}px`
    placed = true
  }

  function show() {
    window.clearTimeout(hideTimer)
    if (dismissCurrent && dismissCurrent !== forceClose) dismissCurrent()
    dismissCurrent = forceClose
    open = true
  }

  function scheduleHide() {
    if (pinned) return
    window.clearTimeout(hideTimer)
    hideTimer = window.setTimeout(() => {
      if (pinned) return
      if (root?.matches(':hover') || pop?.matches(':hover')) return
      open = false
      placed = false
      if (dismissCurrent === forceClose) dismissCurrent = null
    }, 160)
  }

  function onClick(event: MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    if (pinned) {
      forceClose()
      return
    }
    pinned = true
    show()
  }

  $effect(() => {
    if (!open || !pop) return
    const node = pop
    const observer = new ResizeObserver(() => place())
    observer.observe(node)
    place()
    const onScroll = () => place()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  })

  $effect(() => {
    if (!pinned) return
    const onPointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (root?.contains(target) || pop?.contains(target)) return
      forceClose()
    }
    window.addEventListener('pointerdown', onPointer, true)
    return () => window.removeEventListener('pointerdown', onPointer, true)
  })

  $effect(() => () => {
    window.clearTimeout(hideTimer)
    if (dismissCurrent === forceClose) dismissCurrent = null
  })
</script>

<span class="help" bind:this={root}>
  <button
    type="button"
    class="help-btn"
    aria-label={label}
    aria-expanded={open}
    aria-describedby={open ? tipId : undefined}
    onmouseenter={show}
    onmouseleave={scheduleHide}
    onfocus={show}
    onblur={scheduleHide}
    onclick={onClick}
    onkeydown={(event) => {
      if (event.key === 'Escape') forceClose()
    }}>?</button>
  {#if open}
    <span
      id={tipId}
      class="help-pop"
      class:ready={placed}
      style={popStyle}
      role="tooltip"
      bind:this={pop}
      onmouseenter={show}
      onmouseleave={scheduleHide}
    >
      {@render children()}
    </span>
  {/if}
</span>

<style>
  .help {
    position: relative;
    display: inline-flex;
    vertical-align: middle;
    flex: none;
    letter-spacing: 0;
    text-transform: none;
    line-height: 1;
  }

  .help-btn {
    width: 16px;
    height: 16px;
    margin: 0;
    padding: 0;
    display: grid;
    place-items: center;
    border-radius: 50%;
    border: 1px solid var(--line);
    background: var(--bg-deep);
    box-shadow: none;
    color: var(--text-dim);
    font-family: var(--sans);
    font-size: 11px;
    font-weight: 700;
    font-style: normal;
    letter-spacing: 0;
    text-transform: none;
    line-height: 1;
    cursor: help;
    min-height: 0;
  }

  .help-btn:hover,
  .help:focus-within .help-btn {
    color: #1b1408;
    background: var(--orange);
    border-color: var(--orange);
  }

  .help-pop {
    position: fixed;
    z-index: 80;
    width: max-content;
    max-width: min(280px, calc(100vw - 16px));
    padding: 8px 10px;
    background: #1b1a17;
    border: 1px solid var(--orange-2);
    box-shadow: var(--shadow);
    color: var(--text);
    font-family: var(--sans);
    font-size: 13px;
    font-weight: 400;
    font-style: normal;
    letter-spacing: 0;
    text-transform: none;
    line-height: 1.45;
    text-align: left;
    white-space: normal;
    visibility: hidden;
    pointer-events: none;
  }

  .help-pop.ready {
    visibility: visible;
    pointer-events: auto;
  }

  .help-pop :global(p) {
    margin: 0;
    text-transform: none;
    letter-spacing: 0;
    font-weight: 400;
  }

  .help-pop :global(p + p) {
    margin-top: 6px;
  }

  .help-pop :global(code) {
    color: var(--orange);
    font-family: var(--mono);
    font-size: 0.92em;
  }
</style>
